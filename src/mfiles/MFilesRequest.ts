import { MFilesConfig } from "../config.js";

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

function normalizeBaseUrl(baseUrl: string): string {
  // Expect something like https://host/REST (with or without trailing slash).
  return baseUrl.replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("path is required");
  // Accept either "/objects/..." or "objects/..." and always force leading slash.
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  // MFWS endpoints typically end with ".aspx". We won't force it since some
  // deployments may accept extensionless paths, but callers should prefer it.
  return withSlash;
}

function addMethodTunnel(url: string, method: "PUT" | "DELETE"): string {
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}_method=${method}`;
}

export class MFilesRequest {
  private readonly baseUrl: string;
  private readonly config: MFilesConfig;
  private authToken: string | null = null;
  private vaultGuid: string | undefined;
  private isAuthenticating: Promise<void> | null = null;

  constructor(config: MFilesConfig) {
    this.config = config;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.vaultGuid = config.vaultGuid;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      ...(extra || {}),
      "X-Authentication": this.authToken!
    };
    if (this.vaultGuid) headers["X-Vault"] = this.vaultGuid;
    return headers;
  }

  /**
   * Ensures `this.authToken` is a vault-level token if a vault GUID is configured,
   * otherwise an application-level token.
   */
  async ensureAuthenticated(): Promise<void> {
    if (this.authToken) return;

    if (this.config.auth.kind === "token") {
      this.authToken = this.config.auth.token;
      return;
    }

    if (this.isAuthenticating) {
      await this.isAuthenticating;
      if (!this.authToken) throw new Error("Authentication failed (no token set).");
      return;
    }

    this.isAuthenticating = (async () => {
      const auth = this.config.auth;
      if (auth.kind !== "username_password") {
        throw new Error("Internal error: expected username/password auth mode.");
      }

      // 1) Acquire application-level token via direct fetch (avoid recursion).
      const authPath = "/server/authenticationtokens.aspx";
      const url = `${this.baseUrl}${authPath}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          Username: auth.username,
          Password: auth.password
        })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `M-Files authentication failed: POST ${authPath} -> ${res.status} ${res.statusText}\n` +
            `baseUrl=${this.baseUrl}\n` +
            `username=${auth.username}\n` +
            `${text.slice(0, 1500)}`
        );
      }

      const tokenJson = (await res.json().catch(() => null)) as any;
      const token = tokenJson?.Value;
      if (typeof token !== "string" || !token) {
        throw new Error(
          `Unexpected response from ${authPath} (expected { Value: string }). baseUrl=${this.baseUrl}`
        );
      }
      this.authToken = token;

      // 2) Optionally upgrade to vault-level token (direct fetch).
      if (this.vaultGuid) {
        const vaultsPath = "/session/vaults.aspx";
        const vaultsRes = await fetch(`${this.baseUrl}${vaultsPath}`, {
          method: "GET",
          headers: this.authHeaders()
        });
        if (!vaultsRes.ok) {
          const text = await vaultsRes.text().catch(() => "");
          throw new Error(
            `Failed to list vaults: GET ${vaultsPath} -> ${vaultsRes.status} ${vaultsRes.statusText}\n` +
              `baseUrl=${this.baseUrl}\n` +
              `${text.slice(0, 1500)}`
          );
        }
        const vaults = (await vaultsRes.json()) as any[];
        const target = this.vaultGuid!.trim().toUpperCase().replace(/[{}]/g, "");

        const match = vaults.find((v) => {
          const raw = typeof v?.Guid === "string" ? v.Guid : typeof v?.GUID === "string" ? v.GUID : "";
          const current = raw.trim().toUpperCase().replace(/[{}]/g, "");
          return current === target;
        });
        if (!match) {
          throw new Error(
            `Vault GUID ${this.vaultGuid} not found. Available: ${vaults
              .map((v) => (typeof v?.Guid === "string" ? v.Guid : typeof v?.GUID === "string" ? v.GUID : ""))
              .filter((s) => s)
              .join(", ")}`
          );
        }
        const vaultToken = match?.Authentication;
        if (typeof vaultToken !== "string" || !vaultToken) {
          throw new Error(
            `Unexpected vault entry shape from ${vaultsPath} (missing Authentication token). baseUrl=${this.baseUrl}`
          );
        }
        this.authToken = vaultToken;
      }
    })();

    try {
      await this.isAuthenticating;
    } finally {
      this.isAuthenticating = null;
    }
  }

  setVaultGuid(vaultGuid: string | undefined): void {
    this.vaultGuid = vaultGuid;
    // Changing vault GUID implies auth token may need to change.
    this.authToken = null;
  }

  getCurrentVaultGuid(): string | undefined {
    return this.vaultGuid;
  }

  async requestJson<T = unknown>(args: {
    path: string;
    method: HttpMethod;
    body?: Json;
    headers?: Record<string, string>;
  }): Promise<T> {
    const res = await this.requestRaw(args);
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!text) return undefined as T;

    if (!contentType.toLowerCase().includes("application/json")) {
      // MFWS usually returns JSON, but surface helpful errors if not.
      throw new Error(
        `Expected JSON response but got content-type=${contentType}. Body=${text.slice(0, 500)}`
      );
    }
    return JSON.parse(text) as T;
  }

  async requestBytes(args: {
    path: string;
    method: HttpMethod;
    body?: Json;
    headers?: Record<string, string>;
  }): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const res = await this.requestRaw(args);
    const ab = await res.arrayBuffer();
    return { bytes: new Uint8Array(ab), contentType: res.headers.get("content-type") };
  }

  async requestOctetStream(args: {
    path: string;
    method: "POST" | "PUT";
    bytes: Uint8Array;
    headers?: Record<string, string>;
  }): Promise<Response> {
    await this.ensureAuthenticated();

    const path = normalizePath(args.path);
    let url = `${this.baseUrl}${path}`;

    let method: "POST" = "POST";
    if (args.method === "PUT") {
      url = addMethodTunnel(url, "PUT");
      method = "POST";
    }

    const headers: Record<string, string> = this.authHeaders({
      ...(args.headers || {}),
      "content-type": "application/octet-stream"
    });

    const init: RequestInit = { method, headers, body: Buffer.from(args.bytes) };
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `M-Files request failed: ${args.method} ${path} -> ${res.status} ${res.statusText}\n${text.slice(0, 1500)}`
      );
    }
    return res;
  }

  private async requestRaw(args: {
    path: string;
    method: HttpMethod;
    body?: Json;
    headers?: Record<string, string>;
  }): Promise<Response> {
    await this.ensureAuthenticated();

    const path = normalizePath(args.path);
    let url = `${this.baseUrl}${path}`;

    let method: "GET" | "POST" = args.method === "GET" ? "GET" : "POST";
    if (args.method === "PUT" || args.method === "DELETE") {
      url = addMethodTunnel(url, args.method);
      method = "POST";
    }

    const headers: Record<string, string> = this.authHeaders(args.headers);

    let body: string | undefined;
    if (args.body !== undefined) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
      body = JSON.stringify(args.body);
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = body;

    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `M-Files request failed: ${args.method} ${path} -> ${res.status} ${res.statusText}\n${text.slice(0, 1500)}`
      );
    }
    return res;
  }
}


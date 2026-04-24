export type MFilesAuth =
  | { kind: "username_password"; username: string; password: string }
  | { kind: "token"; token: string };

export type MFilesConfig = {
  baseUrl: string;
  auth: MFilesAuth;
  /**
   * Optional vault GUID. If provided and using username/password auth, the server
   * will acquire the vault-level token from `/session/vaults.aspx`.
   */
  vaultGuid?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfigFromEnv(): MFilesConfig {
  const baseUrl = requiredEnv("MFILES_BASE_URL");

  const token = process.env.MFILES_AUTH_TOKEN;
  const username = process.env.MFILES_USERNAME;
  const password = process.env.MFILES_PASSWORD;

  let auth: MFilesAuth;
  if (token) auth = { kind: "token", token };
  else {
    if (!username || !password) {
      throw new Error(
        "Provide either MFILES_AUTH_TOKEN, or both MFILES_USERNAME and MFILES_PASSWORD."
      );
    }
    auth = { kind: "username_password", username, password };
  }

  const vaultGuid = process.env.MFILES_VAULT_GUID;

  const cfg: MFilesConfig = { baseUrl, auth };
  if (vaultGuid) cfg.vaultGuid = vaultGuid;
  return cfg;
}


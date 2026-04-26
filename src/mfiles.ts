import { MFilesRequest } from "./mfiles/MFilesRequest.js";

type PropertyValue = {
  PropertyDef?: number;
  TypedValue?: {
    DisplayValue?: unknown;
    Value?: unknown;
  };
};

type ObjectVersionLike = {
  PropertyValues?: PropertyValue[];
};

function coerceId(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function coerceName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

export class MetadataResolver {
  private byId = new Map<number, string>();
  private byAliasLower = new Map<string, number>();
  private objectTypesById = new Map<number, string>();
  /** Resolves when the background metadata load attempt finishes (success or failure). */
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly mfiles: MFilesRequest) {}

  /**
   * Start loading property/object-type metadata without blocking. Safe to call once after MCP connects.
   * Does not write to stdout/stderr.
   */
  startBackgroundInit(): void {
    if (this.loadPromise !== null) return;
    this.loadPromise = this.safeInit();
  }

  /**
   * Wait for background metadata load to finish (if started). Tool handlers should await this so
   * friendly names and filters work once data is available.
   */
  async ensureReady(): Promise<void> {
    if (this.loadPromise !== null) await this.loadPromise;
  }

  private async safeInit(): Promise<void> {
    try {
      await this.init();
    } catch {
      // Silent: listTools and tools still work with PropertyDef:N fallbacks / empty filter map.
    }
  }

  async init(): Promise<void> {
    this.byId.clear();
    this.byAliasLower.clear();
    this.objectTypesById.clear();

    const propertyDefs = await this.fetchPropertyDefinitions();
    for (const pd of propertyDefs) {
      const id = coerceId(pd?.ID ?? pd?.Id ?? pd?.PropertyDef ?? pd?.PropertyDefID);
      const name = coerceName(pd?.Name ?? pd?.DisplayName ?? pd?.Alias);
      if (id === null || !name) continue;
      this.byId.set(id, name);
      this.byAliasLower.set(name.toLowerCase(), id);
    }

    const objectTypes = await this.fetchObjectTypes();
    for (const ot of objectTypes) {
      const id = coerceId(ot?.ID ?? ot?.Id ?? ot?.ObjectType ?? ot?.ObjectTypeID);
      const name = coerceName(ot?.Name ?? ot?.DisplayName ?? ot?.Alias);
      if (id === null || !name) continue;
      this.objectTypesById.set(id, name);
    }

    // Optional: fetch classes if possible.
    try {
      await this.fetchClasses();
    } catch {
      // Ignore failures during background init.
    }
  }

  private async fetchPropertyDefinitions(): Promise<any[]> {
    const path = "/structure/properties.aspx";
    const data = await this.mfiles.requestJson<any>({ 
      path, 
      method: "GET",
      headers: { "X-Extensions": "MFWA" }
    });
    const arr = this.unwrapArray(data);
    if (arr.length === 0) {
      throw new Error(`Empty property list from ${path} (unexpected shape or no items).`);
    }
    return arr;
  }

  private async fetchObjectTypes(): Promise<any[]> {
    const path = "/structure/objecttypes.aspx";
    const data = await this.mfiles.requestJson<any>({ 
      path, 
      method: "GET",
      headers: { "X-Extensions": "MFWA" }
    });
    const arr = this.unwrapArray(data);
    if (arr.length === 0) {
      throw new Error(`Empty object type list from ${path} (unexpected shape or no items).`);
    }
    return arr;
  }

  private async fetchClasses(): Promise<any[]> {
    // Try primary endpoint first.
    try {
      const data = await this.mfiles.requestJson<any>({
        path: "/structure/classes.aspx",
        method: "GET",
        headers: { "X-Extensions": "MFWA" }
      });
      return this.unwrapArray(data);
    } catch {
      // Fallback to Value List 1 (Classes).
      const data = await this.mfiles.requestJson<any>({
        path: "/valuelists/1/items.aspx",
        method: "GET"
      });
      return this.unwrapArray(data);
    }
  }

  private unwrapArray(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.Items)) return data.Items;
    if (Array.isArray(data?.Results)) return data.Results;
    if (Array.isArray(data?.Value)) return data.Value;
    return [];
  }

  resolveIdToAlias(id: number): string {
    return this.byId.get(id) ?? `PropertyDef:${id}`;
  }

  resolveAliasToId(alias: string): number | null {
    const key = alias.trim().toLowerCase();
    if (!key) return null;
    return this.byAliasLower.get(key) ?? null;
  }

  resolveObjectTypeIdToName(id: number): string {
    return this.objectTypesById.get(id) ?? `ObjectType:${id}`;
  }

  /**
   * Converts MFWS `PropertyValues` into a friendly `Properties` object:
   * `{ "Customer": "Acme Corp", "Invoice Date": "2026-01-01", ... }`.
   *
   * Keeps the original object, adding `Properties` (and leaving `PropertyValues` intact).
   */
  addFriendlyProperties<T extends object>(value: T): T & { Properties?: Record<string, unknown> } {
    const maybe = value as any as ObjectVersionLike;
    if (!Array.isArray(maybe.PropertyValues)) return value as any;

    const out: Record<string, unknown> = {};
    for (const pv of maybe.PropertyValues) {
      const id = coerceId(pv?.PropertyDef);
      if (id === null) continue;
      const alias = this.resolveIdToAlias(id);
      const tv = pv?.TypedValue;
      const v = tv?.DisplayValue ?? tv?.Value ?? null;

      if (Object.prototype.hasOwnProperty.call(out, alias)) {
        const existing = out[alias];
        out[alias] = Array.isArray(existing) ? [...existing, v] : [existing, v];
      } else {
        out[alias] = v;
      }
    }

    return { ...(value as any), Properties: out };
  }

  /**
   * Constructs a MFWS PropertyValues array from a simple object of property names/IDs and values.
   */
  createPropertyValues(properties: Record<string, unknown>): any[] {
    return Object.entries(properties).map(([key, value]) => {
      const id = this.resolveAliasToId(key) ?? coerceId(key);
      if (id === null) throw new Error(`Could not resolve property: ${key}`);

      let typedValue: any;
      if (typeof value === "boolean") {
        typedValue = { DataType: 8, Value: value };
      } else if (typeof value === "number") {
        // If it's a number and it's the 'Class' property (ID 100), it's a Lookup.
        if (id === 100) {
          typedValue = { DataType: 9, Lookup: { Item: value } };
        } else {
          // Default to Integer for other numbers if we don't have schema info.
          // Note: many properties in M-Files are lookups, but we don't have full schema here.
          typedValue = { DataType: 2, Value: value };
        }
      } else if (value === null) {
        typedValue = { DataType: 0, Value: null }; // Unset
      } else {
        // Default to Text.
        typedValue = { DataType: 1, Value: String(value) };
      }

      return { PropertyDef: id, TypedValue: typedValue };
    });
  }
}

export function friendlyifyResult(resolver: MetadataResolver, value: unknown): unknown {
  if (!value || typeof value !== "object") return value;

  if (Array.isArray(value)) return value.map((v) => friendlyifyResult(resolver, v));

  // Common patterns: { Items: [...] }, { Results: [...] }
  const anyVal = value as any;
  if (Array.isArray(anyVal.Items)) {
    return { ...anyVal, Items: anyVal.Items.map((v: any) => friendlyifyResult(resolver, v)) };
  }
  if (Array.isArray(anyVal.Results)) {
    return {
      ...anyVal,
      Results: anyVal.Results.map((v: any) => friendlyifyResult(resolver, v))
    };
  }

  // ObjectVersion-like
  return resolver.addFriendlyProperties(anyVal);
}


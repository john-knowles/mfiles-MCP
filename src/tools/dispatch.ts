import { z } from "zod";
import { MFilesRequest } from "../mfiles/MFilesRequest.js";
import { friendlyifyResult, MetadataResolver } from "../mfiles.js";
import * as pdfParseNs from "pdf-parse";
import { tools } from "./defs.js";
import { ToolName } from "./types.js";

type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string } };

export function listToolsForMcp(): Array<{
  name: string;
  description: string;
  inputSchema: unknown;
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: (z as any).toJSONSchema(t.inputSchema)
  }));
}

function toTextContent(value: unknown): ToolContent[] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function utf8FromBytes(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function splitFilename(filename: string): { title: string; extension: string } {
  const base = filename.trim();
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) return { title: base, extension: "" };
  return { title: base.slice(0, lastDot), extension: base.slice(lastDot + 1) };
}

function extLower(extOrFilename: string | null | undefined): string {
  if (!extOrFilename) return "";
  const s = extOrFilename.toLowerCase();
  const dot = s.lastIndexOf(".");
  return dot >= 0 ? s.slice(dot + 1) : s;
}

function encodeQuery(params: Array<[string, string]>): string {
  if (params.length === 0) return "";
  return (
    "?" +
    params
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&")
  );
}

function paginateAndFilter(
  items: any[],
  limit?: number,
  offset?: number,
  search?: string,
  detailed: boolean = false
): any[] {
  if (!Array.isArray(items)) return [];

  // 1) Normalize and filter
  let processed = items;
  if (search) {
    const lower = search.toLowerCase();
    processed = processed.filter((item) => {
      const name = item?.Name ?? item?.DisplayName ?? item?.Alias;
      const alias = item?.Alias;
      return (
        (typeof name === "string" && name.toLowerCase().includes(lower)) ||
        (typeof alias === "string" && alias.toLowerCase().includes(lower))
      );
    });
  }

  // 2) Paginate
  const start = offset ?? 0;
  const end = limit ? start + limit : processed.length;
  const page = processed.slice(start, end);

  // 3) Strip if not detailed
  if (!detailed) {
    return page.map((item) => ({
      // Enforce strict PascalCase for the API contract
      ID: item?.ID ?? item?.Id ?? item?.PropertyDef ?? item?.PropertyDefID ?? item?.ObjectType ?? item?.ObjectTypeID,
      Name: item?.Name ?? item?.DisplayName ?? item?.Alias,
      Alias: item?.Alias ?? null
    }));
  }

  // Even if detailed, ensure ID/Name are present in PascalCase for consistency
  return page.map((item) => {
    const ID = item?.ID ?? item?.Id ?? item?.PropertyDef ?? item?.PropertyDefID ?? item?.ObjectType ?? item?.ObjectTypeID;
    const Name = item?.Name ?? item?.DisplayName ?? item?.Alias;
    return { ...item, ID, Name };
  });
}

async function checkout(mfiles: MFilesRequest, objectType: number, objectId: number): Promise<any> {
  // 2 == CheckedOutToMe
  return await mfiles.requestJson({
    path: `/objects/${objectType}/${objectId}/latest/checkedout.aspx`,
    method: "PUT",
    body: { Value: "2" }
  });
}

async function checkin(mfiles: MFilesRequest, objectType: number, objectId: number, version: number) {
  // 0 == CheckedIn
  return await mfiles.requestJson({
    path: `/objects/${objectType}/${objectId}/${version}/checkedout.aspx`,
    method: "PUT",
    body: { Value: "0" }
  });
}

export async function callTool(
  mfiles: MFilesRequest,
  resolver: MetadataResolver,
  name: string,
  rawArgs: unknown
): Promise<{ content: ToolContent[] }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  const args = tool.inputSchema.parse(rawArgs ?? {});

  switch (name) {
    case ToolName.DiscoverSchema: {
      const propertyDefinitions = await mfiles.requestJson({
        path: "/structure/properties.aspx",
        method: "GET",
        headers: { "X-Extensions": "MFWA" }
      });
      const objectTypes = await mfiles.requestJson({
        path: "/structure/objecttypes.aspx",
        method: "GET",
        headers: { "X-Extensions": "MFWA" }
      });

      let classDefinitions: any[] = [];
      try {
        const data = await mfiles.requestJson<any>({
          path: "/structure/classes.aspx",
          method: "GET"
        });
        classDefinitions = Array.isArray(data) ? data : Array.isArray(data?.Items) ? data.Items : [];
      } catch {
        try {
          const data = await mfiles.requestJson<any>({
            path: "/valuelists/1/items.aspx",
            method: "GET"
          });
          classDefinitions = Array.isArray(data) ? data : Array.isArray(data?.Items) ? data.Items : [];
        } catch {
          // Ignore
        }
      }

      return {
        content: toTextContent({
          propertyDefinitions,
          objectTypes,
          classDefinitions
        })
      };
    }

    case ToolName.GenericRequest: {
      const a = args as z.infer<(typeof tools)[number]["inputSchema"]> & {
        path: string;
        method: "GET" | "POST" | "PUT" | "DELETE";
        body?: unknown;
        headers?: Record<string, string>;
      };

      const req: any = {
        path: a.path,
        method: a.method
      };
      if (a.body !== undefined) req.body = a.body as any;
      if (a.headers !== undefined) req.headers = a.headers;

      const result = await mfiles.requestJson(req);
      return { content: toTextContent(result) };
    }

    case ToolName.ObjectsSearch: {
      await resolver.ensureReady();
      const { queryString, rawQueryString, limit, offset, filters } = args as any;

      let qs: string;
      if (rawQueryString) {
        // Caller is supplying the entire query string fragment, including leading '?'
        // or any custom parameters.
        qs = queryString;
      } else {
        const params: Array<[string, string]> = [];

        // Quick search: q=<string>
        if (typeof queryString === "string" && queryString.trim().length > 0) {
          params.push(["q", queryString]);
        }

        // Property filters: p{PropertyDefId}=<value>
        if (filters && typeof filters === "object") {
          for (const [alias, v] of Object.entries(filters)) {
            const id = resolver.resolveAliasToId(alias);
            if (id === null) {
              // Fallback to numeric ID if alias fails
              const numericId = Number(alias);
              if (!isNaN(numericId)) {
                params.push([`p${numericId}`, String(v)]);
              }
              continue;
            }
            params.push([`p${id}`, String(v)]);
          }
        }

        if (limit !== undefined) params.push(["limit", String(limit)]);
        if (offset !== undefined) params.push(["offset", String(offset)]);

        qs = encodeQuery(params);
      }

      // M-Files search endpoints vary by server version/config. We try several patterns.
      let result: any;
      try {
        // Pattern 1: .aspx + MFWA
        result = await mfiles.requestJson({
          path: `/objects.aspx${qs}`,
          method: "GET",
          headers: { "X-Extensions": "MFWA" }
        });
      } catch {
        try {
          // Pattern 2: .aspx without extension
          result = await mfiles.requestJson({
            path: `/objects.aspx${qs}`,
            method: "GET"
          });
        } catch {
          // Pattern 3: No extension
          result = await mfiles.requestJson({
            path: `/objects${qs}`,
            method: "GET"
          });
        }
      }

      return { content: toTextContent(friendlyifyResult(resolver, result)) };
    }

    case ToolName.ObjectsGet: {
      await resolver.ensureReady();
      const { objectType, objectId, version } = args as any;
      const path =
        typeof version === "number"
          ? `/objects/${objectType}/${objectId}/${version}.aspx`
          : `/objects/${objectType}/${objectId}/latest.aspx`;
      const result = await mfiles.requestJson({ path, method: "GET" });
      return { content: toTextContent(friendlyifyResult(resolver, result)) };
    }

    case ToolName.ObjectsGetProperties: {
      await resolver.ensureReady();
      const { objectType, objectId, version } = args as any;
      const verPart = version === "latest" ? "latest" : String(version);
      const result = await mfiles.requestJson({
        path: `/objects/${objectType}/${objectId}/${verPart}/properties.aspx`,
        method: "GET"
      });
      // The response is a PropertyValues array. We wrap it in a pseudo-object
      // so friendlyifyResult can process it into a Properties map.
      const wrapped = { PropertyValues: result };
      return { content: toTextContent(friendlyifyResult(resolver, wrapped)) };
    }

    case ToolName.ObjectsCreate: {
      const { objectType, objectVersion } = args as any;
      try {
        const result = await mfiles.requestJson({
          path: `/objects/${objectType}.aspx`,
          method: "POST",
          body: objectVersion
        });
        return { content: toTextContent(result) };
      } catch (err: any) {
        // Return a helpful error message to the LLM.
        return {
          content: [
            {
              type: "text",
              text: `Object creation failed: ${err.message}\n\nTip: M-Files typically requires mandatory properties like 'Class' (ID 100) and 'Name or title' (ID 0). If you're unsure which properties are required, use 'mfiles_structure_classdetails' with the target class ID to see mandatory property definitions.`
            }
          ]
        };
      }
    }
    case ToolName.ObjectsCreateSimple: {
      const { objectType, properties } = args as any;
      await resolver.ensureReady();
      try {
        const propertyValues = resolver.createPropertyValues(properties);
        const result = await mfiles.requestJson({
          path: `/objects/${objectType}.aspx`,
          method: "POST",
          body: { PropertyValues: propertyValues }
        });
        return { content: toTextContent(friendlyifyResult(resolver, result)) };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Object creation failed: ${err.message}\n\nTip: Use 'mfiles_structure_classdetails' to see mandatory property names/IDs for a class.`
            }
          ]
        };
      }
    }

    case ToolName.ObjectsDelete: {
      const { objectType, objectId } = args as any;
      const result = await mfiles.requestJson({
        path: `/objects/${objectType}/${objectId}.aspx`,
        method: "DELETE"
      });
      return { content: toTextContent(result) };
    }
    case ToolName.ObjectsCheckout: {
      const { objectType, objectId } = args as any;
      const result = await checkout(mfiles, objectType, objectId);
      return { content: toTextContent(result) };
    }
    case ToolName.ObjectsCheckin: {
      const { objectType, objectId, version } = args as any;
      const result = await checkin(mfiles, objectType, objectId, version);
      return { content: toTextContent(result) };
    }


    case ToolName.StructurePropertyDefs: {
      const { limit, offset, search, detailed } = args as any;
      const result = await mfiles.requestJson({
        path: "/structure/propertydefs.aspx",
        method: "GET",
        headers: { "X-Extensions": "MFWA" }
      });
      return { content: toTextContent(paginateAndFilter(result as any[], limit, offset, search, detailed)) };
    }
    case ToolName.StructureClassDefs: {
      const { limit, offset, search, detailed } = args as any;
      try {
        const result = await mfiles.requestJson({
          path: `/structure/classdefs.aspx`,
          method: "GET",
          headers: { "X-Extensions": "MFWA" }
        });
        return { content: toTextContent(paginateAndFilter(result as any[], limit, offset, search, detailed)) };
      } catch {
        try {
          const result = await mfiles.requestJson({
            path: `/structure/classes.aspx`,
            method: "GET",
            headers: { "X-Extensions": "MFWA" }
          });
          return { content: toTextContent(paginateAndFilter(result as any[], limit, offset, search, detailed)) };
        } catch {
          const result = await mfiles.requestJson({
            path: `/valuelists/1/items.aspx`,
            method: "GET"
          });
          return { content: toTextContent(paginateAndFilter(result as any[], limit, offset, search, detailed)) };
        }
      }
    }
    case ToolName.StructureClassDetails: {
      const { classId } = args as any;
      const result = await mfiles.requestJson({
        path: `/structure/classes/${classId}.aspx`,
        method: "GET"
      });
      return { content: toTextContent(result) };
    }
    case ToolName.StructureObjectTypes: {
      const { limit, offset, search, detailed } = args as any;
      const result = await mfiles.requestJson({
        path: "/structure/objecttypes.aspx",
        method: "GET",
        headers: { "X-Extensions": "MFWA" }
      });
      return { content: toTextContent(paginateAndFilter(result as any[], limit, offset, search, detailed)) };
    }

    case ToolName.DownloadFile: {
      const { objectId, fileId, objectType, version } = args as any as {
        objectId: number;
        fileId: number;
        objectType: number;
        version: number | "latest";
      };

      const verPart = version === "latest" ? "latest" : String(version);
      const fileInfo = await mfiles.requestJson<any>({
        path: `/objects/${objectType}/${objectId}/${verPart}/files/${fileId}.aspx`,
        method: "GET"
      });

      const filename =
        typeof fileInfo?.Title === "string"
          ? fileInfo.Title
          : typeof fileInfo?.Name === "string"
            ? fileInfo.Name
            : null;

      const extension =
        extLower(fileInfo?.Extension) || (filename ? extLower(filename) : "");

      const contentPath = `/objects/${objectType}/${objectId}/${verPart}/files/${fileId}/content.aspx`;

      if (extension === "txt" || extension === "md") {
        const { bytes } = await mfiles.requestBytes({ path: contentPath, method: "GET" });
        return {
          content: toTextContent({
            filename,
            extension,
            contentType: "text/plain; charset=utf-8",
            content: utf8FromBytes(bytes)
          })
        };
      }

      if (extension === "pdf") {
        try {
          const { bytes } = await mfiles.requestBytes({ path: contentPath, method: "GET" });
          const PDFParse = (pdfParseNs as any).PDFParse || (pdfParseNs as any).default || pdfParseNs;
          const parser = new (PDFParse as any)({ data: Buffer.from(bytes) });
          const data = await parser.getText();
          await parser.destroy();
          return {
            content: toTextContent({
              filename,
              extension,
              contentType: "application/pdf",
              content: data.text
            })
          };
        } catch (err: any) {
          // Fallback to URL if parsing fails (e.g. file too large or corrupted)
          return {
            content: toTextContent({
              filename,
              extension,
              error: `PDF text extraction failed: ${err.message}`,
              download: {
                url: `${mfiles.getBaseUrl()}${contentPath}`,
                method: "GET",
                requiredHeaders: ["X-Authentication"]
              }
            })
          };
        }
      }

      // For other types: return a callable link (client must attach X-Authentication).
      return {
        content: toTextContent({
          filename,
          extension,
          download: {
            url: `${mfiles.getBaseUrl()}${contentPath}`,
            method: "GET",
            requiredHeaders: ["X-Authentication"]
          }
        })
      };
    }

    case ToolName.UploadFile: {
      const { objectId, objectType, filename, contentBase64 } = args as any as {
        objectId: number;
        objectType: number;
        filename: string;
        contentBase64: string;
        mimeType?: string;
      };

      const checkedOutOv = await checkout(mfiles, objectType, objectId);
      const ver = Number(checkedOutOv?.ObjVer?.Version ?? checkedOutOv?.ObjVer?.version);
      if (!Number.isFinite(ver) || ver <= 0) {
        throw new Error("Could not determine checked-out object version from response.");
      }

      // If single-file document, convert to multi-file by setting property 22 to false.
      if (checkedOutOv?.SingleFile === true) {
        await mfiles.requestJson({
          path: `/objects/${objectType}/${objectId}/${ver}/properties/22.aspx`,
          method: "PUT",
          body: { PropertyDef: 22, TypedValue: { DataType: 8, Value: false } }
        });
      }

      const fileBytes = Buffer.from(contentBase64, "base64");

      // Upload to temporary uploads store.
      const uploadRes = await mfiles.requestOctetStream({
        path: "/files.aspx",
        method: "POST",
        bytes: new Uint8Array(fileBytes)
      });
      const uploadInfo = (await uploadRes.json()) as any;

      const { title, extension } = splitFilename(filename);
      uploadInfo.Title = title;
      uploadInfo.Extension = extension;

      // Attach uploaded temp file to object.
      const updatedOv = await mfiles.requestJson({
        path: `/objects/${objectType}/${objectId}/${ver}/files/upload.aspx`,
        method: "POST",
        body: [uploadInfo]
      });

      // Check in.
      const checkedIn = await checkin(mfiles, objectType, objectId, ver);

      return {
        content: toTextContent({
          uploaded: { filename, title, extension },
          objectVersion: updatedOv,
          checkedIn
        })
      };
    }
  }

  // Exhaustiveness.
  throw new Error(`Unhandled tool: ${name}`);
}


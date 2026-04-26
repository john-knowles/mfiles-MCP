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
        path: "/structure/properties",
        method: "GET"
      });
      const objectTypes = await mfiles.requestJson({
        path: "/structure/objecttypes",
        method: "GET"
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
            if (id === null) continue;
            params.push([`p${id}`, String(v)]);
          }
        }

        if (limit !== undefined) params.push(["limit", String(limit)]);
        if (offset !== undefined) params.push(["offset", String(offset)]);

        qs = encodeQuery(params);
      }

      const result = await mfiles.requestJson({
        path: `/objects.aspx${qs}`,
        method: "GET"
      });
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

    case ToolName.ViewsList: {
      const result = await mfiles.requestJson({ path: "/views.aspx", method: "GET" });
      return { content: toTextContent(result) };
    }

    case ToolName.ViewsGetListing: {
      const { viewId, query } = args as any;
      const q = typeof query === "string" && query.length > 0 ? query : "";
      const result = await mfiles.requestJson({
        path: `/views/${viewId}/items.aspx${q}`,
        method: "GET"
      });
      return { content: toTextContent(result) };
    }

    case ToolName.StructurePropertyDefs: {
      const result = await mfiles.requestJson({
        path: "/structure/propertydefs.aspx",
        method: "GET"
      });
      return { content: toTextContent(result) };
    }
    case ToolName.StructureClassDefs: {
      try {
        const result = await mfiles.requestJson({
          path: `/structure/classdefs.aspx`,
          method: "GET"
        });
        return { content: toTextContent(result) };
      } catch {
        try {
          const result = await mfiles.requestJson({
            path: `/structure/classes.aspx`,
            method: "GET"
          });
          return { content: toTextContent(result) };
        } catch {
          const result = await mfiles.requestJson({
            path: `/valuelists/1/items.aspx`,
            method: "GET"
          });
          return { content: toTextContent(result) };
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
      const result = await mfiles.requestJson({
        path: "/structure/objecttypes.aspx",
        method: "GET"
      });
      return { content: toTextContent(result) };
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
          const pdfParse = (pdfParseNs as any).default ?? (pdfParseNs as any);
          const data = await pdfParse(Buffer.from(bytes));
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


import { z } from "zod";
import { ToolDef, ToolName } from "./types.js";

export const tools: ToolDef[] = [
  {
    name: ToolName.DiscoverSchema,
    description:
      "Fetch vault structure metadata used to resolve property and object type IDs: `/structure/properties` and `/structure/objecttypes`.",
    inputSchema: z.object({})
  },
  {
    name: ToolName.GenericRequest,
    description:
      "Generic M-Files REST request for endpoints without a dedicated tool. Supports MFWS method tunneling for PUT/DELETE.",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "MFWS path starting with `/`, e.g. `/objects/0/123/latest.aspx` (include `.aspx` when applicable)."
        ),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE"])
        .default("GET")
        .describe("HTTP method. PUT/DELETE are tunneled via `?_method=` automatically."),
      body: z.unknown().optional().describe("Optional JSON body (for POST/PUT)."),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Optional extra headers (content-type is set automatically for JSON).")
    })
  },

  // /objects
  {
    name: ToolName.ObjectsSearch,
    description:
      "Search objects in the vault via `/objects.aspx`. Supports Quick Search (`q`) and property filters (`p{PropertyDefId}`) via `filters`.",
    inputSchema: z.object({
      queryString: z
        .string()
        .describe(
          "Search query. This is passed as `q` (if supported) or can be provided as a full query string fragment like `?q=...&o=...`."
        ),
      rawQueryString: z
        .boolean()
        .default(false)
        .describe("If true, `queryString` is appended directly after `/objects.aspx`."),
      filters: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          "Optional property filters as key-value pairs, where keys are human-readable property names (e.g. { \"Customer\": \"Acme\" }). Keys are resolved to PropertyDef IDs and encoded as `p{ID}=...`."
        ),
      limit: z.number().int().positive().max(500).optional().describe("Optional result limit."),
      offset: z.number().int().min(0).optional().describe("Optional result offset.")
    })
  },
  {
    name: ToolName.ObjectsGet,
    description:
      "Get an object version via `/objects/{type}/{id}/latest.aspx` or `/objects/{type}/{id}/{version}.aspx`.",
    inputSchema: z.object({
      objectType: z.number().int().nonnegative(),
      objectId: z.number().int().positive(),
      version: z.number().int().positive().optional().describe("If omitted, uses `latest`.")
    })
  },
  {
    name: ToolName.ObjectsCreate,
    description:
      "Create a new object (typically a document) via `/objects/{objectType}.aspx` with an `ObjectVersion` payload.",
    inputSchema: z.object({
      objectType: z
        .number()
        .int()
        .nonnegative()
        .describe("Object type ID, e.g. 0 for Documents."),
      objectVersion: z
        .unknown()
        .describe(
          "ObjectVersion payload. Usually includes `PropertyValues` and optionally `Files`. See MFWS examples for creating documents."
        )
    })
  },
  {
    name: ToolName.ObjectsDelete,
    description:
      "Delete an object via `/objects/{type}/{id}.aspx` (DELETE tunneled if needed).",
    inputSchema: z.object({
      objectType: z.number().int().nonnegative(),
      objectId: z.number().int().positive()
    })
  },
  {
    name: ToolName.ObjectsCheckout,
    description: "Check out an object for editing via `/objects/{type}/{id}/latest/checkedout.aspx`.",
    inputSchema: z.object({
      objectType: z.number().int().nonnegative(),
      objectId: z.number().int().positive()
    })
  },
  {
    name: ToolName.ObjectsCheckin,
    description: "Check in a previously checked-out object version via `/objects/{type}/{id}/{version}/checkedout.aspx`.",
    inputSchema: z.object({
      objectType: z.number().int().nonnegative(),
      objectId: z.number().int().positive(),
      version: z.number().int().positive().describe("The version number to check in.")
    })
  },

  // /views
  {
    name: ToolName.ViewsList,
    description: "List views via `/views.aspx`.",
    inputSchema: z.object({})
  },
  {
    name: ToolName.ViewsGetListing,
    description:
      "Get a view listing via `/views/{viewId}/items.aspx` (optionally with query string).",
    inputSchema: z.object({
      viewId: z.number().int().nonnegative(),
      query: z
        .string()
        .optional()
        .describe("Optional query string beginning with `?`, passed through as-is.")
    })
  },

  // /structure
  {
    name: ToolName.StructurePropertyDefs,
    description: "List property definitions via `/structure/propertydefs.aspx`.",
    inputSchema: z.object({})
  },
  {
    name: ToolName.StructureClassDefs,
    description: "List class definitions via `/structure/classdefs.aspx`.",
    inputSchema: z.object({})
  },
  {
    name: ToolName.StructureClassDetails,
    description: "Get detailed information for a specific class, including mandatory properties.",
    inputSchema: z.object({
      classId: z.number().int().nonnegative().describe("The ID of the class to fetch.")
    })
  },
  {
    name: ToolName.StructureObjectTypes,
    description: "List object types via `/structure/objecttypes.aspx`.",
    inputSchema: z.object({})
  },

  // /files
  {
    name: ToolName.DownloadFile,
    description:
      "Download a file from an object. For .txt/.md returns text; for .pdf returns extracted text; for other types returns a URL to download (requires X-Authentication).",
    inputSchema: z.object({
      objectId: z.number().int().positive().describe("Object ID (Document ID if objectType=0)."),
      fileId: z.number().int().positive().describe("Object file ID."),
      objectType: z
        .number()
        .int()
        .nonnegative()
        .default(0)
        .describe("Object type ID. Defaults to 0 (Documents)."),
      version: z
        .union([z.number().int().positive(), z.literal("latest")])
        .default("latest")
        .describe("Object version number or `latest`.")
    })
  },
  {
    name: ToolName.UploadFile,
    description:
      "Upload a new file to an existing object using the MFWS-supported flow: checkout -> temporary upload to `/files.aspx` (octet-stream) -> add via `/objects/{t}/{id}/{ver}/files/upload.aspx` -> checkin. Handles single-file documents by converting to multi-file first.",
    inputSchema: z.object({
      objectId: z.number().int().positive().describe("Object ID."),
      objectType: z
        .number()
        .int()
        .nonnegative()
        .default(0)
        .describe("Object type ID. Defaults to 0 (Documents)."),
      filename: z.string().describe("Filename including extension, e.g. `notes.txt`."),
      contentBase64: z.string().describe("File content as base64 (no data: prefix)."),
      mimeType: z.string().optional().describe("Optional mime type; used for upload metadata only.")
    })
  }
];


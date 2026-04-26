import { z } from "zod";

export const ToolName = {
  DiscoverSchema: "discover_schema",
  GenericRequest: "generic_mfiles_request",

  ObjectsSearch: "mfiles_objects_search",
  ObjectsGet: "mfiles_objects_get",
  ObjectsGetProperties: "mfiles_objects_get_properties",
  ObjectsCreateSimple: "mfiles_objects_create_simple",
  ObjectsDelete: "mfiles_objects_delete",
  ObjectsCheckout: "mfiles_objects_checkout",
  ObjectsCheckin: "mfiles_objects_checkin",


  StructurePropertyDefs: "mfiles_structure_propertydefs",
  StructureClassDefs: "mfiles_structure_classdefs",
  StructureClassDetails: "mfiles_structure_classdetails",
  StructureObjectTypes: "mfiles_structure_objecttypes",

  DownloadFile: "download_file",
  UploadFile: "upload_file"
} as const;

export type ToolName = (typeof ToolName)[keyof typeof ToolName];

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
};


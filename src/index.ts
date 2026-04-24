import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfigFromEnv } from "./config.js";
import { MFilesRequest } from "./mfiles/MFilesRequest.js";
import { MetadataResolver } from "./mfiles.js";
import { callTool, listToolsForMcp } from "./tools/dispatch.js";

const server = new Server(
  { name: "mfiles-mcp", version: "0.1.0" },
  {
    capabilities: {
      tools: {
        listChanged: true
      }
    }
  }
);

const config = loadConfigFromEnv();
const mfiles = new MFilesRequest(config);
const resolver = new MetadataResolver(mfiles);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.error("Listing tools...");
  const tools = listToolsForMcp();
  console.error(`Returning ${tools.length} tools`);
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return await callTool(mfiles, resolver, name, args);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  resolver.startBackgroundInit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


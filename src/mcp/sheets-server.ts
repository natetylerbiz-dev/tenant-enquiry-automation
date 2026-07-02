import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAvailableSlots } from "../services/sheets.js";

// quiet: true is required, not just tidy — dotenv's stdout banner would
// corrupt the MCP stdio JSON-RPC channel otherwise.
dotenv.config({ quiet: true });

console.error(
  "sheets-mcp-server env check: GOOGLE_SHEETS_ID=%s GOOGLE_SERVICE_ACCOUNT_KEY_PATH=%s",
  Boolean(process.env.GOOGLE_SHEETS_ID),
  Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)
);

const server = new McpServer({
  name: "sheets-mcp-server",
  version: "0.1.0",
});

server.registerTool(
  "get_available_slots",
  {
    title: "Get available viewing slots",
    description:
      "Reads the viewing slots Google Sheet and returns rows with Status \"Available\", optionally filtered by property.",
    inputSchema: {
      property: z
        .string()
        .optional()
        .describe("Exact property name to filter available slots by"),
    },
  },
  async ({ property }) => {
    const slots = await getAvailableSlots(property);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(slots, null, 2),
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("sheets-mcp-server failed to start:", err);
  process.exit(1);
});

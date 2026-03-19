import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerContextTools } from "./tools/context.js";
import { registerMatchingTools } from "./tools/matching.js";
import { registerConsentTools } from "./tools/consent.js";
import { registerHistoryTools } from "./tools/history.js";

const server = new McpServer({
  name: "nod-intros",
  version: "0.1.0",
});

// register all tools
registerProfileTools(server);
registerContextTools(server);
registerMatchingTools(server);
registerConsentTools(server);
registerHistoryTools(server);

// start the server on stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("nod-intros mcp server running on stdio");
}

main().catch((err) => {
  console.error("fatal error:", err);
  process.exit(1);
});

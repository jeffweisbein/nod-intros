import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerIntroTools } from "./tools/intros.js";

const server = new McpServer({
  name: "nod-intros",
  version: "0.1.0",
});

registerIntroTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("nod-intros mcp server running on stdio");
}

main().catch((err) => {
  console.error("fatal error:", err);
  process.exit(1);
});

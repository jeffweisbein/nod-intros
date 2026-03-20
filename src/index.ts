import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerIntroTools } from "./tools/intros.js";

// accept username: npx nod-intros makaeel  OR  npx nod-intros --user makaeel
const args = process.argv.slice(2);
const userFlagIdx = args.indexOf("--user");
if (userFlagIdx !== -1 && args[userFlagIdx + 1]) {
  process.env.NOD_USER_ID = args[userFlagIdx + 1];
} else if (args.length > 0 && !args[0].startsWith("-")) {
  process.env.NOD_USER_ID = args[0];
}

if (!process.env.NOD_USER_ID) {
  console.error("usage: npx nod-intros <username>");
  console.error("  e.g. npx nod-intros makaeel");
  process.exit(1);
}

const server = new McpServer({
  name: "nod-intros",
  version: "0.1.1",
});

registerIntroTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`nod-intros running for user: ${process.env.NOD_USER_ID}`);
}

main().catch((err) => {
  console.error("fatal error:", err);
  process.exit(1);
});

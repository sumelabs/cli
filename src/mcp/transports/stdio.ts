import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSumeMcpServer } from "../server.js";
import type { McpToolFilterOptions } from "../tools.js";

export async function runSumeMcpStdio(options: McpToolFilterOptions = {}) {
  const server = createSumeMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

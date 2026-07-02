import { Command } from "commander";
import { getMode } from "../lib/command.js";
import {
  mcpComingSoonStatus,
  mcpNotLaunchedError,
} from "../lib/mcp-launch-status.js";
import { supportedMcpClientAgents } from "../lib/mcp-client-config.js";
import { renderResult } from "../lib/render.js";

type McpInstallOptions = {
  agent?: string;
  dryRun?: boolean;
};

type McpDoctorOptions = {
  agent?: string;
};

export function registerMcpCommand(program: Command) {
  const mcp = program
    .command("mcp", { hidden: true })
    .description("Sume MCP is coming soon.")
    .action(() => {
      throw mcpNotLaunchedError();
    });

  mcp
    .command("install")
    .description("Sume MCP client setup is coming soon.")
    .requiredOption(
      "--agent <agent>",
      `Target MCP client. Supported: ${supportedMcpClientAgents().join(", ")}.`,
    )
    .option("--dry-run", "Preview setup without writing client config.")
    .action((_options: McpInstallOptions) => {
      throw mcpNotLaunchedError(
        "Sume MCP client setup is coming soon and is not launched in this CLI release yet.",
      );
    });

  mcp
    .command("doctor")
    .description("Show Sume MCP launch status.")
    .option(
      "--agent <agent>",
      `Future MCP client to check. Supported: ${supportedMcpClientAgents().join(", ")}.`,
    )
    .action((options: McpDoctorOptions, command: Command) => {
      const payload = {
        ...mcpComingSoonStatus(),
        ...(options.agent ? { agent: options.agent } : {}),
      };
      renderResult(payload, {
        json: getMode(command).json,
        human: [
          "Sume MCP",
          "",
          ["Status", payload.status],
          ["Launched", payload.launched],
          "",
          payload.message,
          "Use direct Sume CLI commands today.",
        ],
      });
    });
}

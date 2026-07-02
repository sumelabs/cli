import { CliError } from "./errors.js";

export const MCP_COMING_SOON_MESSAGE =
  "Sume MCP is coming soon and is not launched in this CLI release yet.";

export const MCP_DIRECT_CLI_HINT =
  "Use direct Sume CLI commands today: sume login, sume tools list --json, sume avatars create --help, sume avatar-videos create --help, sume jobs --help.";

export const MCP_COMING_SOON_NEXT_STEPS = [
  "Use sume login to authenticate.",
  "Use sume tools list --json for command schemas.",
  "Use sume avatars, sume avatar-videos, and sume jobs commands for launch workflows.",
  "Watch Sume CLI releases for MCP launch.",
];

export function mcpComingSoonStatus() {
  return {
    object: "mcp_status",
    status: "coming_soon",
    launched: false,
    message: MCP_COMING_SOON_MESSAGE,
    recommended_surface: "direct_cli",
    next_steps: MCP_COMING_SOON_NEXT_STEPS,
  };
}

export function mcpNotLaunchedError(message = MCP_COMING_SOON_MESSAGE) {
  return new CliError(message, {
    code: "mcp_not_launched",
    hint: MCP_DIRECT_CLI_HINT,
  });
}

export function agentSetupNotLaunchedError() {
  return new CliError(
    "Sume agent setup is coming soon and is not launched in this CLI release yet.",
    {
      code: "agent_setup_not_launched",
      hint: `No agent or MCP client config was written. ${MCP_DIRECT_CLI_HINT}`,
    },
  );
}

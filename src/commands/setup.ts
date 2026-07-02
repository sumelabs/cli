import { Command } from "commander";
import { getMode, showSubcommandHelp } from "../lib/command.js";
import {
  DEFAULT_AUTH_MODE,
  getApiBaseUrlDiagnostic,
  readConfig,
  redactApiKey,
  resolveConfig,
} from "../lib/config.js";
import {
  buildMcpInstallDryRun,
  installMcpClientConfig,
  inspectMcpClientConfig,
  supportedMcpClientAgents,
} from "../lib/mcp-client-config.js";
import { renderResult } from "../lib/render.js";
import { section, warn } from "../lib/ui.js";

type SetupAgentOptions = {
  agent?: string;
  dryRun?: boolean;
};

export function registerSetupCommand(program: Command) {
  const setup = program
    .command("setup")
    .description("Set up local Sume integrations.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "agent" }),
    );

  setup
    .command("agent")
    .description("Set up read-only Sume MCP for a local agent client.")
    .requiredOption(
      "--agent <agent>",
      `Target MCP client. Supported: ${supportedMcpClientAgents().join(", ")}.`,
    )
    .option("--dry-run", "Preview setup without writing client config.")
    .action((options: SetupAgentOptions, command: Command) => {
      const agent = options.agent ?? "";
      const localConfig = readConfig();
      const resolvedConfig = resolveConfig();
      const configuredBaseUrl = process.env.SUME_API_BASE_URL ?? localConfig.baseUrl;
      const apiWarning = getApiBaseUrlDiagnostic(configuredBaseUrl);
      const mcp = options.dryRun
        ? buildMcpInstallDryRun(agent)
        : installMcpClientConfig(agent);
      const readiness = inspectMcpClientConfig(agent);
      const auth = {
        configured: Boolean(resolvedConfig.apiKey),
        api_key: redactApiKey(resolvedConfig.apiKey),
        auth_mode: resolvedConfig.authMode ?? DEFAULT_AUTH_MODE,
        source: process.env.SUME_API_KEY
          ? "environment"
          : localConfig.apiKey
            ? "config"
            : "none",
      };
      const payload = {
        object: "agent_setup",
        schema_version: 1,
        ok: !readiness.issues.length,
        dry_run: Boolean(options.dryRun),
        agent: mcp.agent,
        client: mcp.client,
        auth,
        api: {
          base_url: resolvedConfig.baseUrl,
          configured_base_url: configuredBaseUrl,
          warnings: apiWarning ? [apiWarning] : [],
        },
        mcp_install: mcp,
        mcp_readiness: readiness,
        safety: {
          mcp_default: "read_only",
          write_tools_enabled: false,
          paid_tools_enabled: false,
          secrets_written: false,
        },
        next_steps: [
          ...(!auth.configured ? ["Run sume login before calling Sume API tools."] : []),
          `Run sume mcp doctor --agent ${mcp.agent} --json to verify config.`,
          "Restart the MCP client so it reloads the Sume server entry.",
          "See docs/mcp-toolsets.md for write and paid MCP gate guidance.",
        ],
      };

      renderResult(payload, {
        json: getMode(command).json,
        human: [
          section("Sume agent setup"),
          ["Agent", payload.agent],
          ["Client", payload.client],
          ["Dry run", payload.dry_run],
          ["Auth", auth.configured ? `configured (${auth.source})` : "not configured"],
          ["MCP config", readiness.status],
          ["Config", readiness.config_location],
          ...(apiWarning ? [warn(apiWarning.message)] : []),
          "",
          "Safety",
          "- Installed MCP config runs only sume mcp.",
          "- Write and paid MCP gates are not persisted.",
          "- API keys and environment values are not written.",
          "",
          "Next steps",
          ...payload.next_steps.map((step) => `- ${step}`),
        ],
      });
    });
}

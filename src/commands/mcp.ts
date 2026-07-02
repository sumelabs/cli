import { Command } from "commander";
import { getMode } from "../lib/command.js";
import { runSumeMcpStdio } from "../mcp/transports/stdio.js";
import {
  DEFAULT_MCP_TOOLSETS,
  MCP_TOOLSETS,
  type McpToolset,
} from "../mcp/tools.js";
import { CliError } from "../lib/errors.js";
import {
  buildMcpDoctorReport,
  buildMcpInstallDryRun,
  installMcpClientConfig,
  inspectMcpClientConfig,
  supportedMcpClientAgents,
} from "../lib/mcp-client-config.js";
import { renderResult } from "../lib/render.js";
import { section, warn } from "../lib/ui.js";

type McpOptions = {
  allowPaid?: boolean;
  allowWrite?: boolean;
  readOnly?: boolean;
  toolsets?: string;
};

type McpInstallOptions = {
  agent?: string;
  dryRun?: boolean;
};

type McpDoctorOptions = {
  agent?: string;
};

const DEFAULT_TOOLSETS = DEFAULT_MCP_TOOLSETS.join(",");

export function registerMcpCommand(program: Command) {
  const mcp = program
    .command("mcp")
    .description("Start the Sume MCP server over stdio.")
    .option("--read-only", "Force read-only tool exposure.")
    .option(
      "--toolsets <list>",
      `Comma-separated toolsets to expose. Available: ${MCP_TOOLSETS.join(", ")}.`,
      DEFAULT_TOOLSETS,
    )
    .option("--allow-write", "Expose mutating MCP tools from selected toolsets.")
    .option(
      "--allow-paid",
      "Expose selected tools that may create paid generation work in the future.",
    )
    .action(async (options: McpOptions) => {
      const readOnly = Boolean(options.readOnly);
      await runSumeMcpStdio({
        allowPaid: readOnly ? false : Boolean(options.allowPaid),
        allowWrite: readOnly ? false : Boolean(options.allowWrite),
        toolsets: parseToolsets(options.toolsets),
      });
    });

  mcp
    .command("install")
    .description("Install MCP client config for the local read-only Sume server.")
    .requiredOption(
      "--agent <agent>",
      `Target MCP client. Supported: ${supportedMcpClientAgents().join(", ")}.`,
    )
    .option("--dry-run", "Print the config snippet without writing files.")
    .action((options: McpInstallOptions, command: Command) => {
      const result = options.dryRun
        ? buildMcpInstallDryRun(options.agent ?? "")
        : installMcpClientConfig(options.agent ?? "");
      renderResult(result, {
        json: getMode(command).json,
        human: [
          options.dryRun ? "Sume MCP install preview" : "Sume MCP installed",
          ["Agent", result.agent],
          ["Client", result.client],
          ["Config", result.config_location],
          ["Dry run", result.dry_run],
          ["Writes config", result.writes_config],
          ["Command", result.command.join(" ")],
          "",
          "Safety",
          ...result.notes.map((note) => `- ${note}`),
          "",
          "Config snippet",
          result.snippet.trimEnd(),
          "",
          "Next steps",
          ...result.next_steps.map((step) => `- ${step}`),
        ],
      });
    });

  mcp
    .command("doctor")
    .description("Inspect local MCP client config readiness.")
    .option(
      "--agent <agent>",
      `Only inspect one MCP client. Supported: ${supportedMcpClientAgents().join(", ")}.`,
    )
    .action((options: McpDoctorOptions, command: Command) => {
      const result = options.agent
        ? {
            ...buildMcpDoctorReport(),
            clients: [inspectMcpClientConfig(options.agent)],
          }
        : buildMcpDoctorReport();
      const summary = {
        total: result.clients.length,
        configured: result.clients.filter((client) => client.status === "configured")
          .length,
        unconfigured: result.clients.filter(
          (client) => client.status === "unconfigured",
        ).length,
        misconfigured: result.clients.filter(
          (client) => client.status === "misconfigured",
        ).length,
      };
      const payload = {
        ...result,
        ok: summary.misconfigured === 0,
        summary,
      };
      const clientLines = payload.clients.flatMap(
        (client): Array<string | [string, unknown]> => [
          `${client.client}`,
          ["Status", client.status],
          ["Config", client.config_location],
          ...(client.issues.length
            ? client.issues.map((issue) => warn(issue.message))
            : []),
        ],
      );
      renderResult(payload, {
        json: getMode(command).json,
        human: [
          section("Sume MCP doctor"),
          ["Configured", `${summary.configured}/${summary.total}`],
          ["Misconfigured", summary.misconfigured],
          "",
          ...clientLines,
        ],
      });
    });
}

function parseToolsets(value: string | undefined): McpToolset[] {
  const rawToolsets = (value ?? DEFAULT_TOOLSETS)
    .split(",")
    .map((toolset) => toolset.trim())
    .filter(Boolean);
  if (rawToolsets.length === 0) {
    throw new CliError("--toolsets must include at least one toolset.", {
      code: "invalid_argument",
    });
  }
  const valid = new Set<string>(MCP_TOOLSETS);
  const invalid = rawToolsets.filter((toolset) => !valid.has(toolset));
  if (invalid.length > 0) {
    throw new CliError(`Unknown MCP toolset: ${invalid.join(", ")}`, {
      code: "invalid_argument",
      hint: `Use one or more of: ${MCP_TOOLSETS.join(", ")}`,
    });
  }
  return rawToolsets as McpToolset[];
}

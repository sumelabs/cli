import { Command } from "commander";
import { getMode } from "../lib/command.js";
import {
  configPath,
  DEFAULT_AUTH_MODE,
  getApiBaseUrlDiagnostic,
  readConfig,
  redactApiKey,
  resolveConfig,
} from "../lib/config.js";
import { mcpComingSoonStatus } from "../lib/mcp-launch-status.js";
import { listToolSchemas } from "../lib/tool-registry.js";
import { renderResult } from "../lib/render.js";
import { section, warn } from "../lib/ui.js";
import { VERSION } from "../lib/version.js";

type DoctorOptions = {
  agent?: boolean;
};

export function registerDoctorCommand(program: Command) {
  program
    .command("doctor")
    .description("Inspect local Sume CLI readiness.")
    .option("--agent", "Return agent-focused diagnostics and next steps.")
    .action((options: DoctorOptions, command: Command) => {
      const localConfig = readConfig();
      const resolvedConfig = resolveConfig();
      const configuredBaseUrl = process.env.SUME_API_BASE_URL ?? localConfig.baseUrl;
      const apiWarning = getApiBaseUrlDiagnostic(configuredBaseUrl);
      const tools = listToolSchemas();
      const payload = {
        object: "doctor_report",
        mode: options.agent ? "agent" : "human",
        schema_version: 1,
        ok: true,
        version: VERSION,
        auth: {
          configured: Boolean(resolvedConfig.apiKey),
          api_key: redactApiKey(resolvedConfig.apiKey),
          auth_mode: resolvedConfig.authMode ?? DEFAULT_AUTH_MODE,
          source: process.env.SUME_API_KEY
            ? "environment"
            : localConfig.apiKey
              ? "config"
              : "none",
        },
        api: {
          base_url: resolvedConfig.baseUrl,
          configured_base_url: configuredBaseUrl,
          warnings: apiWarning ? [apiWarning] : [],
        },
        config: {
          path: configPath(),
        },
        safety: {
          mcp_status: "coming_soon",
          write_commands_require_confirmation: true,
          agent_job_outputs_redact_urls: true,
        },
        mcp: mcpComingSoonStatus(),
        tools: {
          count: tools.length,
          read_only_count: tools.filter((tool) => tool.safety.read_only).length,
          confirmation_required_count: tools.filter(
            (tool) => tool.safety.requires_confirmation,
          ).length,
        },
        recommendations: options.agent
          ? [
              ...(apiWarning ? [apiWarning.suggestion] : []),
              "Run sume tools list --json before selecting commands.",
              "Use sume jobs list/watch/result --agent --json for job recovery.",
              "Ask for explicit user approval before --confirm-submit or --confirm-paid.",
              "Use direct Sume CLI commands today; MCP is coming soon.",
            ]
          : [],
      };
      renderResult(payload, {
        json: getMode(command).json,
        human: [
          section("Sume doctor"),
          ["CLI", VERSION],
          [
            "Auth",
            payload.auth.configured
              ? `configured (${payload.auth.source})`
              : "not configured",
          ],
          ["API", resolvedConfig.baseUrl],
          ["Config", payload.config.path],
          ["MCP", payload.mcp.status],
          ...(apiWarning ? [warn(apiWarning.message)] : []),
        ],
      });
    });
}

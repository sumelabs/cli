import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SumeApiClient } from "../lib/api-client.js";
import { redactForAgent } from "../lib/agent-output.js";
import { resolveConfig } from "../lib/config.js";
import { asCliError } from "../lib/errors.js";
import { VERSION } from "../lib/version.js";
import {
  mcpNextStepsForTool,
  selectMcpTools,
  type McpToolFilterOptions,
} from "./tools.js";

export function createSumeMcpServer(
  options: { client?: SumeApiClient } & McpToolFilterOptions = {},
) {
  const config = resolveConfig();
  const client =
    options.client ??
    new SumeApiClient({
      apiKey: config.apiKey,
      authMode: config.authMode,
      baseUrl: config.baseUrl,
    });

  const server = new McpServer({
    name: "sume",
    version: VERSION,
  });

  for (const tool of selectMcpTools(options)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        annotations: tool.annotations,
        _meta: {
          sume: {
            paid_generation_call: Boolean(tool.paidProviderCall),
            future_paid_generation_call: Boolean(tool.futurePaidProviderCall),
            generation_execution_live:
              tool.providerRuntime === "api_runtime_configured" ? null : false,
            generation_runtime:
              tool.providerRuntime === "api_runtime_configured" ? "sume_api" : "none",
            read_only: tool.readOnly,
            returns_sensitive_url: Boolean(tool.returnsSensitiveUrl),
            toolset: tool.toolset,
          },
        },
      },
      async (input: Record<string, unknown>) => {
        try {
          const result = await tool.execute(input, client);
          return formatMcpToolResponse(tool.name, result);
        } catch (error) {
          return formatMcpToolError(tool.name, error);
        }
      },
    );
  }

  return server;
}

export function formatMcpToolResponse(toolName: string, value: unknown) {
  const redacted = redactForAgent(value);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...(isRecord(redacted.value)
              ? redacted.value
              : { data: redacted.value }),
            agent: {
              safe: true,
              redacted_count: redacted.redactedCount,
              next_steps: mcpNextStepsForTool(toolName),
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

export function formatMcpToolError(toolName: string, error: unknown) {
  const cliError = asCliError(error);
  const redacted = redactForAgent(cliError.toJSON());
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ...(isRecord(redacted.value)
              ? redacted.value
              : { error: redacted.value }),
            agent: {
              safe: true,
              redacted_count: redacted.redactedCount,
              next_steps: mcpNextStepsForTool(toolName),
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

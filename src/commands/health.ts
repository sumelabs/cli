import { Command } from "commander";
import { createClient, getMode } from "../lib/command.js";
import { SumeClient } from "../lib/api-client.js";
import { resolveConfig } from "../lib/config.js";
import { renderResult } from "../lib/render.js";
import { section, statusText } from "../lib/ui.js";

export function registerHealthCommand(program: Command) {
  const health = program.command("health").description("Check Sume API health.");

  health
    .command("service", { isDefault: true })
    .description("Check unversioned API service health.")
    .action(async (_options, command: Command) => {
      const result = await createServiceHealthClient().get("/health");
      renderResult(result, {
        json: getMode(command).json,
        human: healthHuman("/health", result),
      });
    });

  health
    .command("v1")
    .description("Check versioned API health.")
    .action(async (_options, command: Command) => {
      const result = await createClient().get("/health");
      renderResult(result, {
        json: getMode(command).json,
        human: healthHuman("/v1/health", result),
      });
    });
}

function healthHuman(endpoint: string, value: unknown): Array<string | [string, unknown]> {
  const root = record(value);
  const build = record(root.build);
  return [
    section("Health"),
    ["Endpoint", endpoint],
    ["Status", statusText(stringValue(root.status) ?? "unknown")],
    ["Service", stringValue(root.service) ?? "sume-com-api"],
    ["Build", shortSha(stringValue(build.commit_sha)) ?? "n/a"],
  ];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shortSha(value: string | undefined) {
  return value ? value.slice(0, 12) : undefined;
}

function createServiceHealthClient() {
  const config = resolveConfig();
  return new SumeClient({
    apiKey: config.apiKey,
    authMode: config.authMode,
    baseUrl: config.baseUrl.replace(/\/v1$/u, ""),
  });
}

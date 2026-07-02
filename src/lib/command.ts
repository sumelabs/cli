import { Command } from "commander";
import fs from "node:fs";
import { SumeClient } from "./api-client.js";
import { resolveConfig } from "./config.js";
import { CliError } from "./errors.js";

export type CommandMode = {
  json: boolean;
};

export function getMode(command: Command): CommandMode {
  const options = command.optsWithGlobals<{ json?: boolean }>();
  return { json: Boolean(options.json) };
}

export function createClient() {
  const config = resolveConfig();
  return new SumeClient({
    apiKey: config.apiKey,
    authMode: config.authMode,
    baseUrl: config.baseUrl,
  });
}

export function showSubcommandHelp(
  command: Command,
  options: { defaultSubcommand?: string } = {},
) {
  const path = commandPath(command);
  const subcommands = command.commands.map((subcommand) => subcommand.name());
  const hint = options.defaultSubcommand
    ? `Run sume ${path} ${options.defaultSubcommand}.`
    : `Run sume ${path} --help to list subcommands.`;

  if (getMode(command).json) {
    throw new CliError(`Missing subcommand for sume ${path}.`, {
      code: "missing_subcommand",
      details: { subcommands },
      hint,
    });
  }

  command.outputHelp();
}

export function requireString(value: unknown, name: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new CliError(`${name} is required.`, { code: "invalid_argument" });
}

export function optionalPositiveInteger(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${name} must be a positive integer.`, {
      code: "invalid_argument",
    });
  }
  return parsed;
}

export function optionalIntegerInRange(
  value: unknown,
  name: string,
  options: { min: number; max: number },
) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < options.min ||
    parsed > options.max
  ) {
    throw new CliError(
      `${name} must be an integer between ${options.min} and ${options.max}.`,
      { code: "invalid_argument" },
    );
  }
  return parsed;
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalJsonObject(
  options: { payloadJson?: string; payloadFile?: string },
  name = "payload",
) {
  if (options.payloadJson && options.payloadFile) {
    throw new CliError(`Use either --${name}-json or --${name}-file, not both.`, {
      code: "invalid_argument",
    });
  }

  const source = options.payloadJson
    ? { label: `--${name}-json`, value: options.payloadJson }
    : options.payloadFile
      ? {
          label: options.payloadFile,
          value: readPayloadFile(options.payloadFile),
        }
      : null;
  if (!source) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source.value);
  } catch {
    throw new CliError(`${source.label} must be valid JSON.`, {
      code: "invalid_argument",
    });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(`${source.label} must be a JSON object.`, {
      code: "invalid_argument",
    });
  }

  return parsed as Record<string, unknown>;
}

function readPayloadFile(filePath: string) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    throw new CliError(`Unable to read payload file: ${filePath}`, {
      code: "invalid_argument",
    });
  }
}

function commandPath(command: Command) {
  const names: string[] = [];
  let current: Command | null = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(" ");
}

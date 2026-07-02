import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { CliError } from "./errors.js";

export type McpClientAgent = "claude-code" | "codex" | "cursor";

type McpClientDefinition = {
  agent: McpClientAgent;
  configLocation: string;
  displayName: string;
  format: "json" | "toml";
  relativePath: string[];
  snippet: string;
};

const MCP_COMMAND = ["sume", "mcp"] as const;
const MCP_SERVER_NAME = "sume";

const JSON_SNIPPET = `${JSON.stringify(
  {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: MCP_COMMAND[0],
        args: [MCP_COMMAND[1]],
      },
    },
  },
  null,
  2,
)}\n`;

const CLIENTS: McpClientDefinition[] = [
  {
    agent: "codex",
    configLocation: "~/.codex/config.toml",
    displayName: "Codex",
    format: "toml",
    relativePath: [".codex", "config.toml"],
    snippet: codexSnippet(),
  },
  {
    agent: "claude-code",
    configLocation: "~/.claude.json",
    displayName: "Claude Code",
    format: "json",
    relativePath: [".claude.json"],
    snippet: JSON_SNIPPET,
  },
  {
    agent: "cursor",
    configLocation: "~/.cursor/mcp.json",
    displayName: "Cursor",
    format: "json",
    relativePath: [".cursor", "mcp.json"],
    snippet: JSON_SNIPPET,
  },
];

export type McpInstallDryRun = {
  agent: McpClientAgent;
  client: string;
  command: string[];
  config_location: string;
  config_path: string;
  dry_run: true;
  format: McpClientDefinition["format"];
  next_steps: string[];
  notes: string[];
  object: "mcp_install_dry_run";
  safety: {
    paid_tools_enabled: false;
    read_only_default: true;
    write_tools_enabled: false;
  };
  snippet: string;
  supported_agents: McpClientAgent[];
  writes_config: false;
};

export type McpInstallResult = Omit<
  McpInstallDryRun,
  "dry_run" | "object" | "writes_config"
> & {
  dry_run: false;
  object: "mcp_install";
  status: "configured";
  writes_config: true;
};

export type McpClientReadinessStatus =
  | "configured"
  | "misconfigured"
  | "unconfigured";

export type McpClientReadinessIssue = {
  code:
    | "invalid_config"
    | "invalid_server_entry"
    | "unsafe_paid_gate"
    | "unsafe_write_gate"
    | "unexpected_command";
  message: string;
};

export type McpClientReadiness = {
  agent: McpClientAgent;
  client: string;
  config_location: string;
  config_path: string;
  configured: boolean;
  expected_command: string[];
  format: McpClientDefinition["format"];
  issues: McpClientReadinessIssue[];
  next_steps: string[];
  safety: {
    paid_tools_enabled: boolean;
    read_only_default: true;
    write_tools_enabled: boolean;
  };
  status: McpClientReadinessStatus;
};

export type McpDoctorReport = {
  object: "mcp_doctor_report";
  ok: boolean;
  schema_version: 1;
  clients: McpClientReadiness[];
  summary: {
    configured: number;
    misconfigured: number;
    total: number;
    unconfigured: number;
  };
  supported_agents: McpClientAgent[];
};

export function supportedMcpClientAgents() {
  return CLIENTS.map((client) => client.agent);
}

export function buildMcpInstallDryRun(
  agent: string,
  options: { homeDir?: string } = {},
): McpInstallDryRun {
  const client = CLIENTS.find((entry) => entry.agent === agent);
  if (!client) {
    throw new CliError(`Unsupported MCP agent: ${agent}`, {
      code: "invalid_argument",
      hint: `Use one of: ${supportedMcpClientAgents().join(", ")}`,
    });
  }

  const homeDir = options.homeDir ?? os.homedir();
  return {
    object: "mcp_install_dry_run",
    dry_run: true,
    writes_config: false,
    agent: client.agent,
    client: client.displayName,
    config_location: client.configLocation,
    config_path: path.join(homeDir, ...client.relativePath),
    format: client.format,
    command: [...MCP_COMMAND],
    safety: {
      read_only_default: true,
      write_tools_enabled: false,
      paid_tools_enabled: false,
    },
    snippet: client.snippet,
    notes: [
      "This snippet starts the default read-only Sume MCP server.",
      "It does not enable mutating tools or paid generation tools.",
      "No config files are written by this dry run.",
    ],
    next_steps: [
      `Review the ${client.displayName} config snippet before applying it manually.`,
      "Restart the MCP client after adding the Sume server entry.",
      `Run sume mcp install --agent ${client.agent} to install this config automatically.`,
    ],
    supported_agents: supportedMcpClientAgents(),
  };
}

export function installMcpClientConfig(
  agent: string,
  options: { homeDir?: string } = {},
): McpInstallResult {
  const preview = buildMcpInstallDryRun(agent, options);

  if (preview.format === "json") {
    writeJsonClientConfig(preview.config_path);
  } else {
    writeTomlClientConfig(preview.config_path);
  }

  return {
    ...preview,
    object: "mcp_install",
    dry_run: false,
    writes_config: true,
    status: "configured",
    notes: [
      "Configured the default read-only Sume MCP server.",
      "The installed entry does not enable mutating tools or paid generation tools.",
      "No API keys, environment values, or secrets were written.",
    ],
    next_steps: [
      "Restart the MCP client so it reloads the Sume server entry.",
      "Run sume mcp install --agent <agent> --dry-run to preview the config without writing files.",
    ],
  };
}

export function inspectMcpClientConfig(
  agent: string,
  options: { homeDir?: string } = {},
): McpClientReadiness {
  const preview = buildMcpInstallDryRun(agent, options);
  const base = baseReadiness(preview);
  let existing: string | null;
  try {
    existing = readOptionalFile(preview.config_path);
  } catch {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_config",
          message: "Existing MCP client config could not be read.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  if (existing === null) {
    return readiness(base, "unconfigured", [], {
      paidToolsEnabled: false,
      writeToolsEnabled: false,
    });
  }

  if (preview.format === "json") {
    return inspectJsonClientConfig(base, existing);
  }

  return inspectCodexTomlClientConfig(base, existing);
}

export function buildMcpDoctorReport(options: { homeDir?: string } = {}) {
  const clients = supportedMcpClientAgents().map((agent) =>
    inspectMcpClientConfig(agent, options),
  );
  const summary = {
    total: clients.length,
    configured: clients.filter((client) => client.status === "configured").length,
    unconfigured: clients.filter((client) => client.status === "unconfigured")
      .length,
    misconfigured: clients.filter((client) => client.status === "misconfigured")
      .length,
  };
  return {
    object: "mcp_doctor_report",
    schema_version: 1,
    ok: summary.misconfigured === 0,
    supported_agents: supportedMcpClientAgents(),
    summary,
    clients,
  } satisfies McpDoctorReport;
}

function baseReadiness(preview: McpInstallDryRun) {
  return {
    agent: preview.agent,
    client: preview.client,
    config_location: preview.config_location,
    config_path: preview.config_path,
    expected_command: [...MCP_COMMAND],
    format: preview.format,
  };
}

function inspectJsonClientConfig(
  base: ReturnType<typeof baseReadiness>,
  existing: string,
) {
  let root: Record<string, unknown>;
  try {
    root = parseJsonConfig(existing, base.config_path);
  } catch {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_config",
          message: "Existing MCP client config is not valid JSON.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  const servers = root.mcpServers;
  if (servers === undefined) {
    return readiness(base, "unconfigured", [], {
      paidToolsEnabled: false,
      writeToolsEnabled: false,
    });
  }
  if (!isRecord(servers)) {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_config",
          message: "Existing mcpServers config must be a JSON object.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  const server = servers[MCP_SERVER_NAME];
  if (server === undefined) {
    return readiness(base, "unconfigured", [], {
      paidToolsEnabled: false,
      writeToolsEnabled: false,
    });
  }
  if (!isRecord(server)) {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_server_entry",
          message: "Existing Sume MCP server entry must be a JSON object.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  if (
    typeof server.command !== "string" ||
    !Array.isArray(server.args) ||
    !server.args.every((arg) => typeof arg === "string")
  ) {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_server_entry",
          message: "Existing Sume MCP server entry must define command and args.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  return readinessFromCommand(base, server.command, server.args);
}

function inspectCodexTomlClientConfig(
  base: ReturnType<typeof baseReadiness>,
  existing: string,
) {
  try {
    validateTomlHeaders(existing, base.config_path);
  } catch {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_config",
          message: "Existing Codex MCP config has an unsupported TOML table header.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  const section = findTomlSection(existing, `mcp_servers.${MCP_SERVER_NAME}`);
  if (!section) {
    return readiness(base, "unconfigured", [], {
      paidToolsEnabled: false,
      writeToolsEnabled: false,
    });
  }

  const command = readTomlStringValue(section, "command");
  const args = readTomlStringArray(section, "args");
  if (!command || !args) {
    return readiness(
      base,
      "misconfigured",
      [
        {
          code: "invalid_server_entry",
          message: "Existing Sume MCP server entry must define command and args.",
        },
      ],
      { paidToolsEnabled: false, writeToolsEnabled: false },
    );
  }

  return readinessFromCommand(base, command, args);
}

function readinessFromCommand(
  base: ReturnType<typeof baseReadiness>,
  command: string,
  args: string[],
) {
  const writeToolsEnabled = args.includes("--allow-write");
  const paidToolsEnabled = args.includes("--allow-paid");
  const issues: McpClientReadinessIssue[] = [];
  if (command !== MCP_COMMAND[0] || args.length !== 1 || args[0] !== MCP_COMMAND[1]) {
    issues.push({
      code: "unexpected_command",
      message: "Existing Sume MCP server entry must run only `sume mcp`.",
    });
  }
  if (writeToolsEnabled) {
    issues.push({
      code: "unsafe_write_gate",
      message: "Existing Sume MCP server entry persists the write gate.",
    });
  }
  if (paidToolsEnabled) {
    issues.push({
      code: "unsafe_paid_gate",
      message: "Existing Sume MCP server entry persists the paid gate.",
    });
  }

  return readiness(base, issues.length ? "misconfigured" : "configured", issues, {
    paidToolsEnabled,
    writeToolsEnabled,
  });
}

function readiness(
  base: ReturnType<typeof baseReadiness>,
  status: McpClientReadinessStatus,
  issues: McpClientReadinessIssue[],
  options: { paidToolsEnabled: boolean; writeToolsEnabled: boolean },
): McpClientReadiness {
  return {
    ...base,
    status,
    configured: status === "configured",
    safety: {
      read_only_default: true,
      write_tools_enabled: options.writeToolsEnabled,
      paid_tools_enabled: options.paidToolsEnabled,
    },
    issues,
    next_steps: nextStepsForReadiness(base.agent, status, issues),
  };
}

function nextStepsForReadiness(
  agent: McpClientAgent,
  status: McpClientReadinessStatus,
  issues: McpClientReadinessIssue[],
) {
  if (status === "configured") {
    return ["Restart the MCP client if it is already running."];
  }
  if (issues.some((issue) => issue.code === "invalid_config")) {
    return [
      "Fix or back up the existing MCP client config file.",
      `Run sume mcp install --agent ${agent} after the config file is valid.`,
    ];
  }
  return [
    `Run sume mcp install --agent ${agent} to configure the read-only Sume MCP server.`,
  ];
}

function findTomlSection(existing: string, target: string) {
  const lines = existing.split(/\r?\n/u);
  const section: string[] = [];
  let inside = false;
  let found = false;

  for (const line of lines) {
    const header = tomlTableHeader(line);
    if (header) {
      if (inside) break;
      inside = header === target;
      found = found || inside;
      continue;
    }
    if (inside) section.push(line);
  }

  return found ? section : null;
}

function readTomlStringValue(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*(?:#.*)?$`, "u");
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function readTomlStringArray(lines: string[], key: string) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*\\[(.*)\\]\\s*(?:#.*)?$`, "u");
  for (const line of lines) {
    const match = line.match(pattern);
    if (!match) continue;
    const body = match[1] ?? "";
    const values = [...body.matchAll(/"([^"]*)"/gu)].map((entry) => entry[1] ?? "");
    const remainder = body.replace(/"[^"]*"/gu, "").trim();
    if (!/^(?:,\s*)*$/u.test(remainder)) return null;
    return values;
  }
  return null;
}

function writeJsonClientConfig(configPath: string) {
  const existing = readOptionalFile(configPath);
  const root = parseJsonConfig(existing, configPath);
  const servers = readObjectProperty(root, "mcpServers", configPath);
  servers[MCP_SERVER_NAME] = { command: MCP_COMMAND[0], args: [MCP_COMMAND[1]] };
  root.mcpServers = servers;
  writeAtomic(configPath, `${JSON.stringify(root, null, 2)}\n`);
}

function parseJsonConfig(existing: string | null, configPath: string) {
  if (!existing || !existing.trim()) return {} as Record<string, unknown>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    throw new CliError("Existing MCP client config is not valid JSON.", {
      code: "invalid_config",
      details: { path: configPath },
      hint: "Fix or back up the config file before rerunning sume mcp install.",
    });
  }
  if (!isRecord(parsed)) {
    throw new CliError("Existing MCP client config root must be a JSON object.", {
      code: "invalid_config",
      details: { path: configPath },
    });
  }
  return parsed;
}

function readObjectProperty(
  root: Record<string, unknown>,
  key: string,
  configPath: string,
) {
  const value = root[key];
  if (value === undefined) return {} as Record<string, unknown>;
  if (!isRecord(value)) {
    throw new CliError(`Existing ${key} config must be a JSON object.`, {
      code: "invalid_config",
      details: { path: configPath },
    });
  }
  return value;
}

function writeTomlClientConfig(configPath: string) {
  const existing = readOptionalFile(configPath);
  const next = upsertCodexToml(existing ?? "", configPath);
  writeAtomic(configPath, next);
}

function upsertCodexToml(existing: string, configPath: string) {
  validateTomlHeaders(existing, configPath);

  const lines = existing.split(/\r?\n/u);
  const kept: string[] = [];
  let skippingSumeSection = false;

  for (const line of lines) {
    const header = tomlTableHeader(line);
    if (header) {
      skippingSumeSection =
        header === "mcp_servers.sume" || header.startsWith("mcp_servers.sume.");
    }
    if (!skippingSumeSection) kept.push(line);
  }

  const base = trimTrailingBlankLines(kept).join("\n");
  return `${base ? `${base}\n\n` : ""}${codexSnippet()}`;
}

function validateTomlHeaders(existing: string, configPath: string) {
  for (const line of existing.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    if (!tomlTableHeader(line)) {
      throw new CliError("Existing Codex MCP config has an unsupported TOML table header.", {
        code: "invalid_config",
        details: { path: configPath },
        hint: "Fix or back up the config file before rerunning sume mcp install.",
      });
    }
  }
}

function tomlTableHeader(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[")) return null;
  const match =
    trimmed.match(/^\[([A-Za-z0-9_.-]+)\]\s*(?:#.*)?$/u) ??
    trimmed.match(/^\[\[([A-Za-z0-9_.-]+)\]\]\s*(?:#.*)?$/u);
  return match?.[1] ?? null;
}

function trimTrailingBlankLines(lines: string[]) {
  const trimmed = [...lines];
  while (trimmed.length > 0 && !trimmed[trimmed.length - 1]?.trim()) {
    trimmed.pop();
  }
  return trimmed;
}

function codexSnippet() {
  return `[mcp_servers.${MCP_SERVER_NAME}]\ncommand = "${MCP_COMMAND[0]}"\nargs = ["${MCP_COMMAND[1]}"]\n`;
}

function readOptionalFile(configPath: string) {
  try {
    return fs.readFileSync(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function writeAtomic(configPath: string, contents: string) {
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    dir,
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, contents, { mode: 0o600 });
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best-effort cleanup; preserve the original error.
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

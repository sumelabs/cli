import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";
import type { AuthMode } from "./api-client.js";

export const DEFAULT_API_BASE_URL = "https://api.sume.com/v1";
export const DEFAULT_AUTH_MODE: AuthMode = "x-api-key";

export type SumeConfig = {
  apiKey?: string;
  authMode?: AuthMode;
  baseUrl?: string;
  apiBaseUrl?: string;
  base_url?: string;
  api_base_url?: string;
  appBaseUrl?: string;
  app_base_url?: string;
};

export type ResolvedSumeConfig = Required<
  Omit<SumeConfig, "apiBaseUrl" | "base_url" | "api_base_url" | "app_base_url">
>;

export type ApiBaseUrlDiagnostic = {
  code:
    | "production_api_base_url_unversioned"
    | "production_api_base_url_unexpected_path";
  severity: "warning";
  message: string;
  configured_base_url: string;
  resolved_base_url: string;
  suggestion: string;
};

function configDir() {
  return (
    process.env.SUME_CONFIG_DIR ??
    path.join(os.homedir(), ".sume-com")
  );
}

export function configPath() {
  return path.join(configDir(), "config.json");
}

export function readConfig(): SumeConfig {
  const file = configPath();
  if (!fs.existsSync(file)) return {};
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SumeConfig;
  const baseUrl =
    parsed.baseUrl ?? parsed.apiBaseUrl ?? parsed.base_url ?? parsed.api_base_url;
  const appBaseUrl = parsed.appBaseUrl ?? parsed.app_base_url;
  return {
    ...parsed,
    ...(baseUrl ? { baseUrl } : {}),
    ...(appBaseUrl ? { appBaseUrl } : {}),
  };
}

export function writeConfig(config: SumeConfig) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const normalized: SumeConfig = {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.baseUrl ? { baseUrl: normalizeApiBaseUrl(config.baseUrl) } : {}),
    ...(config.appBaseUrl
      ? { appBaseUrl: normalizeHttpBaseUrl(config.appBaseUrl) }
      : {}),
    ...(config.authMode ? { authMode: normalizeAuthMode(config.authMode) } : {}),
  };
  fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function clearConfig() {
  const file = configPath();
  if (fs.existsSync(file)) fs.rmSync(file);
}

export function resolveConfig(): ResolvedSumeConfig {
  const local = readConfig();
  return {
    apiKey: process.env.SUME_API_KEY ?? local.apiKey ?? "",
    authMode: normalizeAuthMode(
      process.env.SUME_API_AUTH_MODE ?? local.authMode ?? DEFAULT_AUTH_MODE,
    ),
    baseUrl:
      normalizeApiBaseUrl(
        process.env.SUME_API_BASE_URL ?? local.baseUrl ?? DEFAULT_API_BASE_URL,
      ),
    appBaseUrl: resolveAppBaseUrl(
      process.env.SUME_APP_BASE_URL ?? local.appBaseUrl,
      process.env.SUME_API_BASE_URL ?? local.baseUrl ?? DEFAULT_API_BASE_URL,
    ),
  };
}

export function redactApiKey(apiKey?: string) {
  if (!apiKey) return "not configured";
  if (apiKey.length <= 8) return "configured";
  return `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`;
}

export function normalizeApiBaseUrl(value: string) {
  const normalized = normalizeHttpBaseUrl(value);
  const parsed = new URL(normalized);
  if (isProductionApiHost(parsed) && isRootPath(parsed.pathname)) {
    return `${parsed.origin}/v1`;
  }
  return normalized;
}

function normalizeHttpBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    throw new CliError("API base URL cannot be empty.", {
      code: "invalid_config",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new CliError(`Invalid API base URL: ${value}`, {
      code: "invalid_config",
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CliError("API base URL must start with http:// or https://.", {
      code: "invalid_config",
    });
  }

  return trimmed;
}

export function getApiBaseUrlDiagnostic(
  value: string | undefined,
): ApiBaseUrlDiagnostic | undefined {
  if (!value?.trim()) return undefined;

  let normalized: string;
  let parsed: URL;
  try {
    normalized = normalizeHttpBaseUrl(value);
    parsed = new URL(normalized);
  } catch {
    return undefined;
  }

  if (!isProductionApiHost(parsed)) return undefined;

  const resolved = normalizeApiBaseUrl(value);
  if (isRootPath(parsed.pathname)) {
    return {
      code: "production_api_base_url_unversioned",
      severity: "warning",
      message: `Configured production API base URL is unversioned; using ${resolved} for API commands.`,
      configured_base_url: normalized,
      resolved_base_url: resolved,
      suggestion:
        "Use https://api.sume.com/v1 in SUME_API_BASE_URL or local config.",
    };
  }

  if (parsed.pathname !== "/v1") {
    return {
      code: "production_api_base_url_unexpected_path",
      severity: "warning",
      message: `Configured api.sume.com path ${parsed.pathname} may not expose CLI API routes; Sume commands expect https://api.sume.com/v1.`,
      configured_base_url: normalized,
      resolved_base_url: resolved,
      suggestion:
        "Use https://api.sume.com/v1 unless you are intentionally testing a custom API path.",
    };
  }

  return undefined;
}

export function resolveAppBaseUrl(value: string | undefined, apiBaseUrl: string) {
  if (value?.trim()) return normalizeHttpBaseUrl(value);

  const parsed = new URL(normalizeApiBaseUrl(apiBaseUrl));
  if (parsed.hostname === "api.sume.com") return "https://app.sume.com";
  return parsed.origin;
}

export function normalizeAuthMode(value: string): AuthMode {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "x-api-key" ||
    normalized === "api-key" ||
    normalized === "apikey"
  ) {
    return "x-api-key";
  }
  if (normalized === "bearer" || normalized === "authorization") {
    return "bearer";
  }
  throw new CliError("Auth mode must be x-api-key or bearer.", {
    code: "invalid_config",
  });
}

function isProductionApiHost(parsed: URL) {
  return parsed.hostname.toLowerCase() === "api.sume.com";
}

function isRootPath(pathname: string) {
  return pathname === "" || pathname === "/";
}

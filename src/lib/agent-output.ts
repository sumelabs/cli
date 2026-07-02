import { isSafePublicMediaUrl } from "./avatar-summary.js";

const URL_PATTERN = /\bhttps?:\/\/[^\s"')]+/iu;
const SENSITIVE_KEY_PATTERN =
  /(^|_)(account|authorization|bearer|credential|email|object|owner|password|private|secret|signed|storage|token|upload|url|uri|user|workspace)(_|$)/iu;
const SENSITIVE_EXACT_KEYS = new Set([
  "apikey",
  "api_key",
  "access_token",
  "auth_token",
  "authorization",
  "bearer_token",
  "client_secret",
  "credential",
  "id_token",
  "password",
  "provider_job_id",
  "provider_request_id",
  "provider_task_id",
  "refresh_token",
  "secret",
  "session_token",
  "token",
]);

export type RedactionResult = {
  redactedCount: number;
  value: unknown;
};

export function redactForAgent(value: unknown): RedactionResult {
  const state = { redactedCount: 0 };
  return {
    value: redactValue(value, state, undefined),
    redactedCount: state.redactedCount,
  };
}

export function withAgentMetadata(
  value: unknown,
  options: { nextSteps?: string[] } = {},
) {
  const redacted = redactForAgent(value);
  return {
    ...(isRecord(redacted.value) ? redacted.value : { data: redacted.value }),
    agent: {
      safe: true,
      redacted_count: redacted.redactedCount,
      next_steps: options.nextSteps ?? [],
    },
  };
}

function redactValue(
  value: unknown,
  state: { redactedCount: number },
  key: string | undefined,
): unknown {
  if (typeof value === "string") {
    if (shouldRedactString(key, value)) {
      state.redactedCount += 1;
      return "[redacted]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, state, key));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, state, entryKey),
      ]),
    );
  }
  return value;
}

function shouldRedactString(key: string | undefined, value: string) {
  if (URL_PATTERN.test(value)) {
    return !(key === "public_url" && isSafePublicMediaUrl(value));
  }
  if (!key) return false;
  if (isSensitiveKey(key)) return true;
  return false;
}

function isSensitiveKey(key: string) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^a-z0-9]+/giu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(normalized)) return true;
  if (SENSITIVE_EXACT_KEYS.has(normalized.replaceAll("_", ""))) return true;
  return SENSITIVE_KEY_PATTERN.test(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

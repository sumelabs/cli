import { Chalk, type ChalkInstance } from "chalk";

export const symbols = {
  bullet: "-",
  error: "[x]",
  info: "[i]",
  success: "[ok]",
  warning: "[!]",
};

const SUME_WORDMARK = [
  "██████╗ ██╗   ██╗███╗   ███╗███████╗     ██████╗██╗     ██╗",
  "██╔════╝██║   ██║████╗ ████║██╔════╝    ██╔════╝██║     ██║",
  "██████╗ ██║   ██║██╔████╔██║█████╗      ██║     ██║     ██║",
  "╚════██╗██║   ██║██║╚██╔╝██║██╔══╝      ██║     ██║     ██║",
  "██████╔╝╚██████╔╝██║ ╚═╝ ██║███████╗    ╚██████╗███████╗██║",
  "╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚══════╝     ╚═════╝╚══════╝╚═╝",
];

const FIELD_INDENT = "  ";

export function decorationsEnabled(stream: NodeJS.WriteStream = process.stdout) {
  return (
    !("NO_COLOR" in process.env) &&
    !("CI" in process.env) &&
    Boolean(stream.isTTY)
  );
}

function chalkFor(stream: NodeJS.WriteStream = process.stdout) {
  return new Chalk({ level: decorationsEnabled(stream) ? 1 : 0 });
}

function withColor(apply: (chalk: ChalkInstance, value: string) => string) {
  return (input: string) => apply(chalkFor(), input);
}

export const colors = {
  bold: withColor((chalk, input) => chalk.bold(input)),
  cyan: withColor((chalk, input) => chalk.cyan(input)),
  dim: withColor((chalk, input) => chalk.dim(input)),
  green: withColor((chalk, input) => chalk.green(input)),
  red: withColor((chalk, input) => chalk.red(input)),
  whiteBright: withColor((chalk, input) => chalk.whiteBright(input)),
  yellow: withColor((chalk, input) => chalk.yellow(input)),
};

export function helpBanner(
  stream: NodeJS.WriteStream = process.stdout,
  options: { force?: boolean } = {},
) {
  if (!options.force && !decorationsEnabled(stream)) return "";
  return [
    colors.whiteBright(SUME_WORDMARK.join("\n")),
    colors.dim("Agent-first developer tools for sume.com"),
    colors.dim("─────────────────────────────────────────────────────────────"),
  ].join("\n");
}

export const label = (input: string) => colors.dim(input);
export const value = (input: unknown, key?: string) => formatScalar(input, key);
export const command = (input: string) => colors.whiteBright(input);
export const flag = (input: string) => colors.whiteBright(input);
export const hint = (input: string) => colors.dim(input);
export const ok = (input: string) => `${colors.green(symbols.success)} ${input}`;
export const info = (input: string) => `${colors.cyan(symbols.info)} ${input}`;
export const warn = (input: string) =>
  `${colors.yellow(symbols.warning)} ${input}`;
export const fail = (input: string) => `${colors.red(symbols.error)} ${input}`;
export const section = (input: string) => colors.bold(colors.whiteBright(input));
export const empty = (input = "n/a") => colors.dim(input);

export function field(name: string, fieldValue: unknown) {
  return `${FIELD_INDENT}${label(`${name}:`)} ${formatScalar(fieldValue, name)}`;
}

export function formatFields(fields: Array<[string, unknown]>) {
  const width = Math.max(...fields.map(([key]) => key.length), 0);
  return fields.map(([key, fieldValue]) => {
    return `${FIELD_INDENT}${label(`${key.padEnd(width)}:`)} ${formatScalar(fieldValue, key)}`;
  });
}

export function statusText(status: string) {
  const normalized = status.toLowerCase();
  if (
    [
      "approved",
      "authenticated",
      "available",
      "complete",
      "completed",
      "configured",
      "current",
      "ok",
      "ready",
      "success",
      "succeeded",
    ].includes(normalized)
  ) {
    return colors.whiteBright(status);
  }
  if (
    [
      "in_progress",
      "pending",
      "processing",
      "queued",
      "submitted",
      "waiting",
    ].includes(normalized)
  ) {
    return colors.yellow(status);
  }
  if (
    [
      "canceled",
      "cancelled",
      "denied",
      "error",
      "expired",
      "failed",
      "invalid",
      "missing",
      "not configured",
      "timeout",
      "timed_out",
      "unauthenticated",
    ].includes(normalized)
  ) {
    return colors.red(status);
  }
  return colors.bold(status);
}

export function formatScalar(input: unknown, key?: string): string {
  if (input === null) return empty("null");
  if (input === undefined || input === "") return empty();
  if (typeof input === "boolean") {
    return input ? colors.whiteBright("true") : empty("false");
  }
  if (typeof input === "number" || typeof input === "bigint") {
    return colors.whiteBright(String(input));
  }
  const text = String(input);
  if (key?.toLowerCase() === "status") return statusText(text);
  if (/^https?:\/\//iu.test(text)) return colors.whiteBright(text);
  return text;
}

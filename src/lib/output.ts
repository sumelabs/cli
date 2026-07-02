import { redactForAgent } from "./agent-output.js";
import { asCliError } from "./errors.js";
import { fail, field, formatScalar, section } from "./ui.js";

export function outputJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function emitError(error: unknown, options: { json?: boolean } = {}) {
  const cliError = asCliError(error);
  if (options.json) {
    const redacted = redactForAgent(cliError.toJSON());
    process.stderr.write(`${JSON.stringify(redacted.value, null, 2)}\n`);
    return;
  }

  process.stderr.write(`${fail(formatScalar(cliError.message))}\n`);
  const details = [
    cliError.code ? field("Code", cliError.code) : null,
    cliError.status ? field("HTTP", cliError.status) : null,
    cliError.requestId ? field("Request ID", cliError.requestId) : null,
    cliError.hint ? field("Hint", cliError.hint) : null,
  ].filter((line): line is string => Boolean(line));
  if (details.length) {
    process.stderr.write(`\n${section("Details")}\n${details.join("\n")}\n`);
  }
}

export function emitHuman(lines: string[]) {
  process.stdout.write(`${lines.filter(Boolean).join("\n")}\n`);
}

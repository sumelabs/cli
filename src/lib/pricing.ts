import { basename } from "node:path";
import { ApiError } from "../api/errors.ts";
import { replaceMedia } from "./body.ts";

export const PLACEHOLDER_HOST = "upload.invalid";

export function placeholderUrl(path: string): string {
  return `https://${PLACEHOLDER_HOST}/${encodeURIComponent(basename(path))}`;
}

export function withPlaceholders(
  body: Record<string, unknown>,
  localFiles: readonly string[],
): Record<string, unknown> {
  const copy = structuredClone(body);
  replaceMedia(copy, new Map(localFiles.map((path) => [path, placeholderUrl(path)])));
  return copy;
}

export function needsUploadToPrice(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.apiCode !== "media_unreadable" && error.apiCode !== "media_read_unavailable") return false;
  const details = (error.details ?? {}) as { source_host?: unknown };
  return details.source_host === PLACEHOLDER_HOST || error.message.includes(PLACEHOLDER_HOST);
}

export function priceNeedsUpload(
  error: ApiError,
  model: string,
  body: Record<string, unknown>,
  localFiles: readonly string[],
): ApiError {
  const file = fieldFile(error, body, localFiles) ?? (localFiles[0] as string);
  return error.rephrased(
    `Can't price ${file} before it is uploaded: ${model} is priced by its length, which Sume reads from the file.`,
    `Upload it (free), then price the URL it prints: sume upload ${shellQuote(file)}. ` +
      `Or let a run do both: sume run ${model} … --max-usd <dollars> uploads, prices, then submits.`,
  );
}

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

export function fieldFile(
  error: ApiError,
  body: Record<string, unknown>,
  localFiles: readonly string[],
): string | undefined {
  const field = (error.details as { field?: unknown } | undefined)?.field;
  if (typeof field !== "string") return undefined;
  const match = /^([a-z_]+)(?:\[(\d+)\])?$/u.exec(field);
  if (!match) return undefined;
  const value = body[match[1] as string];
  const item = Array.isArray(value) ? value[Number(match[2] ?? 0)] : value;
  return typeof item === "string" && localFiles.includes(item) ? item : undefined;
}

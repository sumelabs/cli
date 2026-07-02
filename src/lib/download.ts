import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CliError } from "./errors.js";

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_BYTES = 250 * 1024 * 1024;

export type DownloadOptions = {
  fetchImpl?: typeof fetch;
  filename?: string;
  maxBytesPerFile?: number;
  maxFiles?: number;
  outputDir: string;
};

export type DownloadResult = {
  downloaded: Array<{
    bytes: number;
    content_type: string | null;
    filename: string;
    path: string;
  }>;
  failed: Array<{ reason: string }>;
  object: "media_download";
  output_dir: string;
  remote_urls_redacted: true;
  source_count: number;
};

export async function downloadMediaFromValue(
  value: unknown,
  options: DownloadOptions,
): Promise<DownloadResult> {
  const refs = extractMediaRefs(value).slice(0, options.maxFiles ?? DEFAULT_MAX_FILES);
  return downloadMediaRefs(refs, options);
}

export async function downloadMediaRefs(
  refs: MediaRef[],
  options: DownloadOptions,
): Promise<DownloadResult> {
  mkdirSync(options.outputDir, { recursive: true });
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES;
  const downloaded: DownloadResult["downloaded"] = [];
  const failed: DownloadResult["failed"] = [];

  for (const [index, ref] of refs.entries()) {
    try {
      const response = await fetchImpl(ref.url);
      if (!response.ok) {
        failed.push({ reason: `HTTP ${response.status}` });
        continue;
      }
      const contentType = response.headers.get("content-type");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) {
        failed.push({ reason: `File exceeds ${maxBytes} bytes` });
        continue;
      }
      const requestedFilename = refs.length === 1 ? options.filename : undefined;
      const filename = safeFilename(
        requestedFilename ?? ref.filename ?? filenameFromUrl(ref.url, index),
      );
      const path = join(options.outputDir, filename);
      writeFileSync(path, bytes);
      downloaded.push({
        bytes: bytes.byteLength,
        content_type: contentType,
        filename,
        path,
      });
    } catch (error) {
      failed.push({
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    object: "media_download",
    output_dir: options.outputDir,
    source_count: refs.length,
    downloaded,
    failed,
    remote_urls_redacted: true,
  };
}

type MediaRef = {
  filename?: string;
  url: string;
};

export function extractMediaRefs(value: unknown): MediaRef[] {
  const refs: MediaRef[] = [];
  visit(value, undefined, refs);
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.url)) return false;
    seen.add(ref.url);
    return true;
  });
}

function visit(value: unknown, filename: string | undefined, refs: MediaRef[]) {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, filename, refs);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const ownFilename = firstString(record, [
    "filename",
    "file_name",
    "name",
    "title",
  ]) ?? filename;
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string" && isDownloadableUrlKey(key) && isHttpsUrl(entry)) {
      refs.push({ url: entry, filename: ownFilename });
    } else {
      visit(entry, ownFilename, refs);
    }
  }
}

function isDownloadableUrlKey(key: string) {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase();
  if (
    [
      "api_url",
      "callback_url",
      "events_url",
      "result_url",
      "status_url",
      "webhook_url",
    ].includes(normalized)
  ) {
    return false;
  }
  return (
    normalized === "url" ||
    normalized.endsWith("_url") ||
    normalized === "download" ||
    normalized === "download_url"
  );
}

function isHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function filenameFromUrl(value: string, index: number) {
  try {
    const url = new URL(value);
    const name = basename(url.pathname);
    if (name && name !== "/" && name !== ".") return name;
  } catch {
    // fall through
  }
  return `sume-media-${index + 1}`;
}

function safeFilename(value: string) {
  const clean = value
    .replace(/[/\\?%*:|"<>]/gu, "-")
    .replace(/\s+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  if (clean) return clean;
  throw new CliError("Could not derive a safe output filename.", {
    code: "invalid_download_filename",
  });
}

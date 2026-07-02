import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { SumeClient } from "./api-client.js";
import { CliError } from "./errors.js";

const MAX_LOCAL_ASSET_UPLOAD_BYTES = 512 * 1024 * 1024;

type LocalAssetUploadOptions = {
  checksumSha256?: string;
  client: SumeClient;
  contentType?: string;
  filename?: string;
  idempotencyKey?: string;
  mediaType?: "image" | "video" | "audio" | "file";
  path: string;
};

export async function uploadLocalAsset(options: LocalAssetUploadOptions) {
  const file = await readLocalUploadFile(options.path);
  const filename = options.filename ?? basename(options.path);
  const contentType =
    options.contentType ?? inferContentType(options.path) ?? missingContentType();
  const checksumSha256 =
    options.checksumSha256?.toLowerCase() ?? sha256(file.body);

  const presign = await options.client.post(
    "/assets/upload-url",
    {
      checksum_sha256: checksumSha256,
      content_type: contentType,
      filename,
      ...(options.mediaType ? { media_type: options.mediaType } : {}),
      size_bytes: file.size,
    },
    { headers: { "Idempotency-Key": options.idempotencyKey } },
  );
  const uploadUrl = firstString(presign, [
    ["data", "upload", "url"],
    ["data", "upload_url"],
    ["upload", "url"],
    ["upload_url"],
  ]);
  const assetId = firstString(presign, [
    ["data", "asset", "id"],
    ["data", "upload", "asset_id"],
    ["asset", "id"],
    ["upload", "asset_id"],
    ["asset_id"],
  ]);
  if (!uploadUrl) {
    throw new CliError("Asset upload-url response did not include an upload URL.", {
      code: "invalid_upload_url_response",
    });
  }
  if (!assetId) {
    throw new CliError("Asset upload-url response did not include an asset id.", {
      code: "invalid_upload_url_response",
    });
  }

  const upload = await options.client.uploadToSignedUrl({
    url: uploadUrl,
    headers: uploadHeaders(presign, contentType),
    body: file.body,
  });
  await options.client.post(
    `/assets/${encodeURIComponent(assetId)}/complete`,
    {
      checksum_sha256: checksumSha256,
      size_bytes: file.size,
    },
    { headers: { "Idempotency-Key": options.idempotencyKey } },
  );

  return {
    asset_id: assetId,
    content_type: contentType,
    filename,
    object: "local_asset_upload",
    size_bytes: file.size,
    upload,
  };
}

export async function createAssetDownloadUrl(client: SumeClient, assetId: string) {
  const response = await client.get(
    `/assets/${encodeURIComponent(assetId)}/download-url`,
  );
  const url = firstString(response, [
    ["data", "download", "url"],
    ["data", "download_url"],
    ["download", "url"],
    ["download_url"],
    ["url"],
  ]);
  if (!url) {
    throw new CliError("Asset download-url response did not include a URL.", {
      code: "invalid_download_url_response",
    });
  }
  return url;
}

async function readLocalUploadFile(path: string) {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new CliError("Unable to read supplied file path.", {
      code: "invalid_argument",
    });
  }
  if (!fileStat.isFile()) {
    throw new CliError("file must point to a single file.", {
      code: "invalid_argument",
    });
  }
  if (fileStat.size <= 0) {
    throw new CliError("file must point to a non-empty file.", {
      code: "invalid_argument",
    });
  }
  if (fileStat.size > MAX_LOCAL_ASSET_UPLOAD_BYTES) {
    throw new CliError("Local asset uploads are limited to 512 MiB.", {
      code: "upload_too_large",
    });
  }
  return {
    body: await readFile(path),
    size: fileStat.size,
  };
}

function uploadHeaders(value: unknown, fallbackContentType: string) {
  const headers = record(
    getPath(value, ["data", "upload", "headers"]) ??
      getPath(value, ["upload", "headers"]),
  );
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(headers)) {
    if (typeof entry === "string") output[key] = entry;
  }
  if (!Object.keys(output).some((key) => key.toLowerCase() === "content-type")) {
    output["Content-Type"] = fallbackContentType;
  }
  return output;
}

function firstString(value: unknown, paths: string[][]) {
  for (const path of paths) {
    const candidate = getPath(value, path);
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function getPath(value: unknown, path: string[]) {
  let current = value;
  for (const part of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function inferContentType(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      return undefined;
  }
}

function missingContentType(): never {
  throw new CliError(
    "content-type is required when the local photo file extension is not jpg, jpeg, png, webp, gif, heic, or heif.",
    { code: "invalid_argument" },
  );
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

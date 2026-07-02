import { Command } from "commander";
import {
  createClient,
  getMode,
  optionalIntegerInRange,
  optionalJsonObject,
  optionalString,
  requireString,
  showSubcommandHelp,
} from "../lib/command.js";
import { redactForAgent, withAgentMetadata } from "../lib/agent-output.js";
import { downloadMediaFromValue } from "../lib/download.js";
import { CliError } from "../lib/errors.js";
import { renderResult } from "../lib/render.js";

const ASSET_MEDIA_TYPES = ["image", "video", "audio", "file"] as const;

type AssetOutputOptions = {
  agent?: boolean;
  redactUrls?: boolean;
};

type AssetCreateOptions = AssetOutputOptions & {
  confirmSubmit?: boolean;
  idempotencyKey?: string;
  mediaType?: string;
  payloadFile?: string;
  payloadJson?: string;
  sourceUrl?: string;
};

type AssetListOptions = AssetOutputOptions & {
  cursor?: string;
  limit?: string;
  mediaType?: string;
  status?: string;
};

type AssetUploadUrlOptions = AssetOutputOptions & {
  checksumSha256?: string;
  confirmSubmit?: boolean;
  contentType?: string;
  filename?: string;
  idempotencyKey?: string;
  mediaType?: string;
  payloadFile?: string;
  payloadJson?: string;
  sizeBytes?: string;
};

type AssetCompleteOptions = AssetOutputOptions & {
  checksumSha256?: string;
  confirmSubmit?: boolean;
  idempotencyKey?: string;
  payloadFile?: string;
  payloadJson?: string;
  sizeBytes?: string;
};

type AssetDownloadOptions = {
  filename?: string;
  outputDir: string;
};

export function registerAssetsCommand(program: Command) {
  const assets = program
    .command("assets")
    .description("Register and inspect Sume API input assets.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  assets
    .command("list")
    .description("List input assets.")
    .option("--limit <n>", "Maximum number of assets, 1-100.", "20")
    .option("--cursor <cursor>", "Opaque pagination cursor.")
    .option("--media-type <type>", "Filter by media type: image, video, audio, or file.")
    .option(
      "--status <status>",
      "Filter by status: registered, pending_upload, ready, mirrored, failed, or archived.",
    )
    .option("--agent", "Return agent-safe redacted asset summaries.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(async (options: AssetListOptions, command: Command) => {
      const limit = optionalIntegerInRange(options.limit, "limit", {
        min: 1,
        max: 100,
      });
      const mediaType = options.mediaType
        ? readAssetMediaType(options.mediaType)
        : undefined;
      const status = options.status ? readAssetStatus(options.status) : undefined;
      const endpoint = "/assets";
      const result = await createClient().get(endpoint, {
        query: {
          cursor: optionalString(options.cursor),
          limit,
          media_type: mediaType,
          status,
        },
      });
      renderResult(result, {
        json: getMode(command).json,
        transform: assetOutput(result, options, "list"),
        human: assetListHuman(endpoint, { limit, mediaType, status }),
      });
    });

  assets
    .command("create")
    .description("Register a public HTTPS URL as an input asset.")
    .option("--payload-json <json>", "Exact API request body as JSON.")
    .option("--payload-file <path>", "Read exact API request body from a JSON file.")
    .option("--source-url <url>", "Public HTTPS source URL to register.")
    .option("--media-type <type>", "Media type hint: image, video, audio, or file.")
    .option("--idempotency-key <key>", "Idempotency-Key request header.")
    .option(
      "--confirm-submit",
      "Confirm the user approved registering this input asset.",
    )
    .option("--agent", "Return agent-safe JSON with redaction and next steps.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(async (options: AssetCreateOptions, command: Command) => {
      const payload =
        optionalJsonObject(options) ?? buildAssetPayloadFromOptions(options);
      requireAssetConfirmation(options);

      const endpoint = "/assets";
      const result = await createClient().post(endpoint, payload, {
        headers: idempotencyHeaders(options),
      });
      renderResult(result, {
        json: getMode(command).json,
        transform: assetOutput(result, options, "create"),
        human: assetHuman("Input asset registered.", endpoint, result),
      });
    });

  assets
    .command("get")
    .description("Get one input asset by id.")
    .argument("<asset_id>", "Asset id.")
    .option("--agent", "Return an agent-safe redacted asset summary.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (assetId: string, options: AssetOutputOptions, command: Command) => {
        const normalizedAssetId = requireString(assetId, "asset_id");
        const endpoint = `/assets/${encodeURIComponent(normalizedAssetId)}`;
        const result = await createClient().get(endpoint);
        renderResult(result, {
          json: getMode(command).json,
          transform: assetOutput(result, options, "get"),
          human: assetHuman("Input asset.", endpoint, result),
        });
      },
    );

  assets
    .command("upload-url")
    .description("Create a short-lived direct-upload URL for an input asset.")
    .option("--payload-json <json>", "Exact API request body as JSON.")
    .option("--payload-file <path>", "Read exact API request body from a JSON file.")
    .option("--content-type <type>", "MIME type to upload, for example image/png.")
    .option("--size-bytes <n>", "Declared upload size in bytes.")
    .option("--media-type <type>", "Media type hint: image, video, audio, or file.")
    .option("--filename <name>", "Optional original filename for metadata.")
    .option("--checksum-sha256 <hex>", "Optional SHA-256 checksum hex.")
    .option("--idempotency-key <key>", "Idempotency-Key request header.")
    .option(
      "--confirm-submit",
      "Confirm the user approved creating this signed upload URL.",
    )
    .option("--agent", "Return agent-safe JSON with signed URL redaction.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(async (options: AssetUploadUrlOptions, command: Command) => {
      const payload =
        optionalJsonObject(options) ?? buildUploadUrlPayloadFromOptions(options);
      requireAssetConfirmation(options, "creating a signed upload URL");

      const endpoint = "/assets/upload-url";
      const result = await createClient().post(endpoint, payload, {
        headers: idempotencyHeaders(options),
      });
      renderResult(result, {
        json: getMode(command).json,
        transform: assetOutput(result, options, "upload-url"),
        human: assetHuman("Input asset upload URL created.", endpoint, result),
      });
    });

  assets
    .command("complete")
    .description("Mark a direct-uploaded input asset as complete.")
    .argument("<asset_id>", "Asset id.")
    .option("--payload-json <json>", "Exact API request body as JSON.")
    .option("--payload-file <path>", "Read exact API request body from a JSON file.")
    .option("--size-bytes <n>", "Client-observed uploaded size in bytes.")
    .option("--checksum-sha256 <hex>", "Client-observed SHA-256 checksum hex.")
    .option("--idempotency-key <key>", "Idempotency-Key request header.")
    .option("--confirm-submit", "Confirm the user approved completing this asset.")
    .option("--agent", "Return agent-safe JSON with redaction and next steps.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (
        assetId: string,
        options: AssetCompleteOptions,
        command: Command,
      ) => {
        const normalizedAssetId = requireString(assetId, "asset_id");
        const payload =
          optionalJsonObject(options) ?? buildCompletePayloadFromOptions(options);
        requireAssetConfirmation(options, "completing an uploaded asset");

        const endpoint = `/assets/${encodeURIComponent(normalizedAssetId)}/complete`;
        const result = await createClient().post(endpoint, payload, {
          headers: idempotencyHeaders(options),
        });
        renderResult(result, {
          json: getMode(command).json,
          transform: assetOutput(result, options, "complete"),
          human: assetHuman(
            "Input asset upload completed.",
            `/assets/${normalizedAssetId}/complete`,
            result,
          ),
        });
      },
    );

  assets
    .command("download-url")
    .description("Create a short-lived download URL for a ready first-party asset.")
    .argument("<asset_id>", "Asset id.")
    .option("--agent", "Return agent-safe JSON with signed URL redaction.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (assetId: string, options: AssetOutputOptions, command: Command) => {
        const normalizedAssetId = requireString(assetId, "asset_id");
        const endpoint = `/assets/${encodeURIComponent(normalizedAssetId)}/download-url`;
        const result = await createClient().get(endpoint);
        renderResult(result, {
          json: getMode(command).json,
          transform: assetOutput(result, options, "download-url"),
          human: assetHuman(
            "Input asset download URL created.",
            `/assets/${normalizedAssetId}/download-url`,
            result,
          ),
        });
      },
    );

  assets
    .command("download")
    .description("Download a ready first-party asset into an explicit local directory.")
    .argument("<asset_id>", "Asset id.")
    .requiredOption("--output-dir <dir>", "Directory to write downloaded media.")
    .option("--filename <name>", "Optional local filename.")
    .action(
      async (assetId: string, options: AssetDownloadOptions, command: Command) => {
        const normalizedAssetId = requireString(assetId, "asset_id");
        const endpoint = `/assets/${encodeURIComponent(normalizedAssetId)}/download-url`;
        const result = await createClient().get(endpoint);
        const download = await downloadMediaFromValue(result, {
          outputDir: options.outputDir,
          filename: options.filename,
        });
        renderResult(download, {
          json: getMode(command).json,
          human: downloadHuman("Input asset downloaded.", download),
        });
      },
    );
}

function buildAssetPayloadFromOptions(options: AssetCreateOptions) {
  const payload: Record<string, unknown> = {
    source_url: requireString(options.sourceUrl, "source-url"),
  };
  if (options.mediaType) payload.media_type = readAssetMediaType(options.mediaType);
  return payload;
}

function readAssetMediaType(value: string) {
  if (ASSET_MEDIA_TYPES.includes(value as (typeof ASSET_MEDIA_TYPES)[number])) {
    return value;
  }
  throw new CliError("media-type must be image, video, audio, or file.", {
    code: "invalid_argument",
  });
}

function readAssetStatus(value: string) {
  const statuses = [
    "registered",
    "pending_upload",
    "ready",
    "mirrored",
    "failed",
    "archived",
  ] as const;
  if (statuses.includes(value as (typeof statuses)[number])) return value;
  throw new CliError(
    "status must be registered, pending_upload, ready, mirrored, failed, or archived.",
    { code: "invalid_argument" },
  );
}

function requireAssetConfirmation(
  options: { confirmSubmit?: boolean },
  action = "registering an input asset",
) {
  if (options.confirmSubmit) return;
  throw new CliError(
    `${action} is a write operation. Re-run with --confirm-submit after the user explicitly approves.`,
    {
      code: "confirmation_required",
      hint: "Use --confirm-submit only after confirming the asset operation is safe.",
    },
  );
}

function idempotencyHeaders(options: { idempotencyKey?: string }) {
  return {
    "Idempotency-Key": options.idempotencyKey,
  };
}

function buildUploadUrlPayloadFromOptions(options: AssetUploadUrlOptions) {
  const payload: Record<string, unknown> = {
    content_type: requireString(options.contentType, "content-type"),
    size_bytes: optionalIntegerInRange(options.sizeBytes, "size-bytes", {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
    }),
  };
  if (options.mediaType) payload.media_type = readAssetMediaType(options.mediaType);
  if (options.filename) payload.filename = requireString(options.filename, "filename");
  if (options.checksumSha256) {
    payload.checksum_sha256 = readSha256(options.checksumSha256);
  }
  return payload;
}

function buildCompletePayloadFromOptions(options: AssetCompleteOptions) {
  const payload: Record<string, unknown> = {};
  const sizeBytes = optionalIntegerInRange(options.sizeBytes, "size-bytes", {
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
  });
  if (sizeBytes !== undefined) payload.size_bytes = sizeBytes;
  if (options.checksumSha256) {
    payload.checksum_sha256 = readSha256(options.checksumSha256);
  }
  return payload;
}

function readSha256(value: string) {
  const normalized = requireString(value, "checksum-sha256");
  if (/^[a-fA-F0-9]{64}$/u.test(normalized)) return normalized.toLowerCase();
  throw new CliError("checksum-sha256 must be a 64-character hex string.", {
    code: "invalid_argument",
  });
}

function assetOutput(
  value: unknown,
  options: AssetOutputOptions,
  command: "complete" | "create" | "download-url" | "get" | "list" | "upload-url",
) {
  if (options.agent) {
    return withAgentMetadata(value, {
      nextSteps: assetNextSteps(command),
    });
  }
  if (options.redactUrls) return redactForAgent(value).value;
  return undefined;
}

function assetNextSteps(
  command: "complete" | "create" | "download-url" | "get" | "list" | "upload-url",
) {
  if (command === "list") {
    return [
      "Use sume assets get <asset_id> --agent --json for one asset.",
      "Use ready asset ids as public API inputs only when the user explicitly asks.",
      "Do not echo raw asset URLs in agent reports.",
    ];
  }
  if (command === "create") {
    return [
      "Capture data.asset.id from the response.",
      "Use sume assets get <asset_id> --agent --json to refresh asset metadata.",
      "The public API does not expose the registered source URL; do not echo raw asset URLs in agent reports.",
    ];
  }
  if (command === "upload-url") {
    return [
      "Do not log or echo the signed upload URL.",
      "PUT bytes to the redacted upload URL outside the CLI only after explicit user approval.",
      "After uploading, run sume assets complete <asset_id> --confirm-submit --agent --json.",
    ];
  }
  if (command === "complete") {
    return [
      "Use sume assets get <asset_id> --agent --json to confirm the asset is ready.",
      "Use ready asset ids as public API inputs only when the user explicitly asks.",
    ];
  }
  if (command === "download-url") {
    return [
      "Do not log or echo signed download URLs in agent reports.",
      "Use non-agent output only when the user explicitly asks for the short-lived URL.",
    ];
  }
  return [
    "Use asset metadata as context for current image/video generation requests only when the user explicitly asks.",
    "Do not echo raw asset URLs in agent reports.",
    "Use sume assets list --agent --json when you need to browse known assets.",
  ];
}

function assetListHuman(
  endpoint: string,
  filters: { limit?: number; mediaType?: string; status?: string },
) {
  return [
    "Input assets.",
    `Endpoint: ${endpoint}`,
    filters.limit ? `Limit: ${filters.limit}` : "",
    filters.mediaType ? `Media type: ${filters.mediaType}` : "",
    filters.status ? `Status: ${filters.status}` : "",
  ].filter(Boolean);
}

function assetHuman(label: string, endpoint: string, value: unknown) {
  const asset = readAsset(value);
  return [
    label,
    `Endpoint: ${endpoint}`,
    asset.id ? `Asset ID: ${asset.id}` : "",
    asset.media_type ? `Media type: ${asset.media_type}` : "",
    asset.status ? `Status: ${asset.status}` : "",
    "The public API omits the registered source URL from asset responses.",
  ].filter(Boolean);
}

function readAsset(value: unknown): Record<string, unknown> {
  const root = record(value);
  const data = record(root.data);
  return record(data.asset);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function downloadHuman(
  label: string,
  value: { downloaded: Array<{ path: string; bytes: number }>; failed: unknown[] },
) {
  return [
    label,
    ["Downloaded", value.downloaded.length] as [string, unknown],
    ["Failed", value.failed.length] as [string, unknown],
    ...value.downloaded.map(
      (item) => [`File`, `${item.path} (${item.bytes} bytes)`] as [string, unknown],
    ),
  ];
}

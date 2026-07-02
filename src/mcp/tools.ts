import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { SumeApiClient } from "../lib/api-client.js";
import { summarizeAvatarGeneration } from "../lib/avatar-summary.js";
import { CliError } from "../lib/errors.js";
import { uploadLocalAsset } from "../lib/local-asset-upload.js";
import {
  AVATAR_MODEL_IDS,
  avatarModelRunEndpoint,
  normalizeAvatarModelId,
} from "../lib/models.js";
import { validateAvatarVideoScriptDuration } from "../lib/avatar-video-duration.js";
import {
  AVATAR_VIDEO_QUALITY_VALUES,
  DEFAULT_AVATAR_VIDEO_QUALITY,
} from "../lib/quality.js";

export type ToolInputSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

export const MCP_TOOLSETS = [
  "account",
  "assets",
  "catalog",
  "health",
  "jobs",
  "avatars",
  "avatar-videos",
  "tools",
] as const;

export type McpToolset = (typeof MCP_TOOLSETS)[number];

export type SumeMcpTool = {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations: ToolAnnotations;
  futurePaidProviderCall?: boolean;
  paidProviderCall?: boolean;
  providerRuntime?: "none" | "api_runtime_configured";
  returnsSensitiveUrl?: boolean;
  readOnly: boolean;
  toolset: McpToolset;
  execute: (input: unknown, client: SumeApiClient) => Promise<unknown>;
};

export type McpToolFilterOptions = {
  allowPaid?: boolean;
  allowWrite?: boolean;
  toolsets?: McpToolset[];
};

const AVATAR_VIDEO_MODEL_ID = "sume/avatar-video/v1.0";

export const DEFAULT_MCP_TOOLSETS: McpToolset[] = [
  "health",
  "account",
  "catalog",
  "jobs",
  "avatars",
  "avatar-videos",
  "tools",
];

const emptyInputSchema = z.object({});
const limitInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
const toolNameInputSchema = z.object({
  name: z.string().min(1),
});
const listAssetsInputSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  media_type: z.enum(["image", "video", "audio", "file"]).optional(),
  status: z
    .enum(["registered", "pending_upload", "ready", "mirrored", "failed", "archived"])
    .optional(),
});
const assetIdInputSchema = z.object({ asset_id: z.string().min(1) });
const assetPayloadInputSchema = z.object({
  media_type: z.enum(["image", "video", "audio", "file"]).optional(),
  source_url: z.string().url(),
});
const assetSubmitInputSchema = z.object({
  idempotency_key: z.string().min(1).optional(),
  payload: assetPayloadInputSchema,
});
const assetUploadUrlPayloadInputSchema = z.object({
  checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u).optional(),
  content_type: z.string().min(1),
  filename: z.string().min(1).max(255).optional(),
  media_type: z.enum(["image", "video", "audio", "file"]).optional(),
  size_bytes: z.number().int().min(1),
});
const assetUploadUrlSubmitInputSchema = z.object({
  idempotency_key: z.string().min(1).optional(),
  payload: assetUploadUrlPayloadInputSchema,
});
const assetUploadCompletePayloadInputSchema = z.object({
  checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u).optional(),
  size_bytes: z.number().int().min(1).optional(),
});
const assetUploadCompleteInputSchema = z.object({
  asset_id: z.string().min(1),
  idempotency_key: z.string().min(1).optional(),
  payload: assetUploadCompletePayloadInputSchema.default({}),
});
const assetUploadFileInputSchema = z.object({
  checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/u).optional(),
  content_type: z.string().min(1),
  filename: z.string().min(1).max(255).optional(),
  idempotency_key: z.string().min(1).optional(),
  media_type: z.enum(["image", "video", "audio", "file"]).optional(),
  path: z.string().min(1),
});
const jobIdInputSchema = z.object({ job_id: z.string().min(1) });
const jobEventsInputSchema = z.object({
  job_id: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(50),
});
const jobWaitInputSchema = z.object({
  interval_seconds: z.number().min(1).max(60).default(5),
  job_id: z.string().min(1),
  timeout_seconds: z.number().min(0).max(600).default(300),
});
const jobCancelInputSchema = z.object({
  idempotency_key: z.string().min(1).optional(),
  job_id: z.string().min(1),
});
const avatarIdInputSchema = z.object({ avatar_id: z.string().min(1) });
const avatarListInputSchema = z.object({
  handle: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  status: z
    .enum(["ready", "queued", "processing", "completed", "failed", "canceled"])
    .optional(),
});
const avatarVideoIdInputSchema = z.object({ avatar_video_id: z.string().min(1) });
const paidSubmissionInputSchema = z.object({
  dry_run: z.boolean().optional(),
  idempotency_key: z.string().min(1),
  max_spend_usd: z.number().min(0),
  payload: z.object({}).passthrough(),
});
const avatarVideoCreateInputSchema = z
  .object({
    aspect_ratio: z.string().min(1).optional(),
    avatar_handle: z.string().min(1).optional(),
    dry_run: z.boolean().optional(),
    idempotency_key: z.string().min(1),
    max_spend_usd: z.number().min(0),
    mode: z.enum(["async", "sync", "subscribe", "webhook"]).optional(),
    payload: z.object({}).passthrough().optional(),
    product_image: z.string().url().optional(),
    quality: z
      .enum(AVATAR_VIDEO_QUALITY_VALUES)
      .default(DEFAULT_AVATAR_VIDEO_QUALITY),
    resolution: z.enum(["720p"]).optional(),
    scene_image_url: z.string().url().optional(),
    scene_prompt: z.string().min(1).optional(),
    script: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    wait_timeout_seconds: z.number().int().min(0).max(30).optional(),
    webhook_url: z.string().url().optional(),
  })
  .strict();
const avatarSubmissionInputSchema = paidSubmissionInputSchema.extend({
  model: z
    .enum([
      AVATAR_MODEL_IDS.base,
      "sume/avatar-1.0",
      "sume/avatar/v1",
    ])
    .optional(),
});
const avatarCommunicationInputSchema = z.object({
  mode: z.enum(["async", "sync", "subscribe", "webhook"]).optional(),
  webhook_url: z.string().url().optional(),
  wait_timeout_seconds: z.number().int().min(0).max(30).optional(),
});
const avatarCreateBaseInputSchema = z
  .object({
    dry_run: z.boolean().optional(),
    avatar_handle: z.string().min(1),
    idempotency_key: z.string().min(1),
    max_spend_usd: z.number().min(0),
    model: z
      .enum([
        AVATAR_MODEL_IDS.base,
        "sume/avatar-1.0",
        "sume/avatar/v1",
      ])
      .optional(),
  })
  .merge(avatarCommunicationInputSchema);
const avatarCreatePromptInputSchema = avatarCreateBaseInputSchema.extend({
  prompt: z.string().min(1),
});
const avatarCreatePropsInputSchema = avatarCreateBaseInputSchema.extend({
  age: z.number().int().min(20).max(80),
  ethnicity: z.enum([
    "Asian",
    "South Asian",
    "Southeast Asian",
    "Black",
    "Hispanic",
    "Middle Eastern",
    "White",
    "Wasian",
  ]),
  sex: z.enum(["male", "female"]),
});
const avatarCreatePhotoUrlInputSchema = avatarCreateBaseInputSchema.extend({
  image_url: z.string().url(),
});
type AvatarVideoCreateInput = z.infer<typeof avatarVideoCreateInputSchema>;

function title(name: string) {
  return name
    .split(".")
    .map((part) => part.replaceAll("-", " "))
    .join(" ");
}

function readOnlyAnnotations(name: string): ToolAnnotations {
  return {
    title: title(name),
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}

function submitAnnotations(name: string): ToolAnnotations {
  return {
    title: title(name),
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  };
}

const MAX_MCP_ASSET_UPLOAD_BYTES = 512 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function firstString(value: unknown, paths: string[][]) {
  for (const path of paths) {
    const candidate = getPath(value, path);
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
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

async function readUploadFile(path: string) {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch {
    throw new CliError("Unable to read supplied file path.", {
      code: "invalid_argument",
    });
  }
  if (!fileStat.isFile()) {
    throw new CliError("path must point to a single file.", {
      code: "invalid_argument",
    });
  }
  if (fileStat.size <= 0) {
    throw new CliError("path must point to a non-empty file.", {
      code: "invalid_argument",
    });
  }
  if (fileStat.size > MAX_MCP_ASSET_UPLOAD_BYTES) {
    throw new CliError("MCP asset uploads are limited to 512 MiB.", {
      code: "upload_too_large",
    });
  }
  return {
    body: await readFile(path),
    size: fileStat.size,
  };
}

function readJobStatus(value: unknown): string {
  for (const candidate of [
    getPath(value, ["status"]),
    getPath(value, ["data", "status"]),
    getPath(value, ["data", "job", "status"]),
    getPath(value, ["job", "status"]),
  ]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "unknown";
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function readUsageMicros(value: unknown) {
  const candidate =
    getPath(value, ["data", "usage", "billable_amount_usd_micros"]) ??
    getPath(value, ["usage", "billable_amount_usd_micros"]);
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function readAdmissionAccepted(value: unknown) {
  const candidate =
    getPath(value, ["data", "admission", "would_accept"]) ??
    getPath(value, ["admission", "would_accept"]);
  return candidate === true;
}

function maxSpendToMicros(value: number) {
  return Math.floor(value * 1_000_000);
}

function readPaidGenerationInput<T>(
  input: unknown,
  schema: z.ZodType<T>,
  toolName: string,
) {
  const candidate = record(input);
  if (
    typeof candidate.idempotency_key !== "string" ||
    !candidate.idempotency_key.trim()
  ) {
    throw new CliError(`${toolName} requires idempotency_key.`, {
      code: "missing_mcp_tool_argument",
    });
  }
  if (
    typeof candidate.max_spend_usd !== "number" ||
    !Number.isFinite(candidate.max_spend_usd)
  ) {
    throw new CliError(`${toolName} requires max_spend_usd.`, {
      code: "missing_mcp_tool_argument",
    });
  }
  if (
    !candidate.payload ||
    typeof candidate.payload !== "object" ||
    Array.isArray(candidate.payload)
  ) {
    throw new CliError(`${toolName} requires payload.`, {
      code: "missing_mcp_tool_argument",
    });
  }
  return schema.parse(input);
}

async function submitPaidGeneration({
  client,
  decorateResult,
  endpoint,
  idempotencyKey,
  maxSpendUsd,
  model,
  payload,
  dryRun,
  toolName,
}: {
  client: SumeApiClient;
  decorateResult?: (value: unknown) => unknown;
  endpoint: string;
  idempotencyKey: string;
  maxSpendUsd: number;
  model: string;
  payload: Record<string, unknown>;
  dryRun?: boolean;
  toolName: string;
}) {
  const preview = await client.post("/generation/admission-preview", {
    model,
    request: payload,
  });
  const billableMicros = readUsageMicros(preview);
  if (billableMicros === null) {
    throw new CliError("Sume cost/readiness preview did not include a usage estimate.", {
      code: "missing_usage_estimate",
    });
  }
  if (billableMicros > maxSpendToMicros(maxSpendUsd)) {
    throw new CliError("Estimated Sume usage exceeds max_spend_usd.", {
      code: "max_spend_exceeded",
      details: {
        estimated_spend_usd: billableMicros / 1_000_000,
        max_spend_usd: maxSpendUsd,
      },
    });
  }
  if (dryRun === true) {
    const result = {
      object: "mcp_paid_generation_dry_run",
      tool: toolName,
      model,
      would_submit: false,
      preview,
      next_steps: [
        `Call ${toolName} again without dry_run to submit after reviewing the preview.`,
      ],
    };
    return decorateResult ? decorateResult(result) : result;
  }
  if (!readAdmissionAccepted(preview)) {
    throw new CliError("Sume cost/readiness preview rejected the request.", {
      code: "generation_admission_rejected",
      details: { preview },
    });
  }
  const result = await client.post(endpoint, payload, {
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return decorateResult ? decorateResult(result) : result;
}

function addAvatarSummary(
  value: unknown,
  requestedAvatar?: Record<string, unknown>,
) {
  const avatarSummary = summarizeAvatarGeneration(value, { requestedAvatar });
  return {
    ...record(value),
    avatar_summary: avatarSummary,
  };
}

function addAvatarSummaryIfPresent(value: unknown) {
  const avatarSummary = summarizeAvatarGeneration(value);
  if (
    !avatarSummary.avatar_id &&
    !avatarSummary.handle &&
    avatarSummary.artifacts.length === 0
  ) {
    return value;
  }
  return {
    ...record(value),
    avatar_summary: avatarSummary,
  };
}

function communicationOptions(input: {
  mode?: "async" | "sync" | "subscribe" | "webhook";
  webhook_url?: string;
  wait_timeout_seconds?: number;
}) {
  return {
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.webhook_url ? { webhook_url: input.webhook_url } : {}),
    ...(input.wait_timeout_seconds !== undefined
      ? { wait_timeout_seconds: input.wait_timeout_seconds }
      : {}),
  };
}

function avatarModelPayload(
  avatarHandle: string,
  input: Record<string, unknown>,
  communication: Record<string, unknown>,
) {
  return {
    avatar_handle: avatarHandle,
    input,
    ...communication,
  };
}

function asPublicErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Avatar result could not be read after the job reached a terminal state.";
}

async function submitAvatarGeneration({
  client,
  dryRun,
  idempotencyKey,
  maxSpendUsd,
  model,
  payload,
  toolName,
}: {
  client: SumeApiClient;
  dryRun?: boolean;
  idempotencyKey: string;
  maxSpendUsd: number;
  model?: string;
  payload: Record<string, unknown>;
  toolName: string;
}) {
  const modelId = normalizeAvatarModelId(model);
  const requestedAvatar = {
    ...record(payload.input),
    handle:
      typeof payload.avatar_handle === "string" ? payload.avatar_handle : undefined,
  };
  return submitPaidGeneration({
    client,
    decorateResult: (value) => addAvatarSummary(value, requestedAvatar),
    endpoint: avatarModelRunEndpoint(modelId),
    idempotencyKey,
    maxSpendUsd,
    model: modelId,
    payload,
    dryRun,
    toolName,
  });
}

function isTerminalJobStatus(status: string) {
  return [
    "canceled",
    "cancelled",
    "complete",
    "completed",
    "error",
    "errored",
    "failed",
    "success",
    "succeeded",
  ].includes(normalizeStatus(status));
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const mcpTools: SumeMcpTool[] = [
  {
    name: "tools.list",
    description: "List local Sume CLI and MCP tool contracts with safety metadata.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("tools.list"),
    readOnly: true,
    toolset: "tools",
    execute: async () => {
      const { listToolSchemas } = await import("../lib/tool-registry.js");
      return {
        object: "tool_schema_list",
        count: listToolSchemas().length,
        tools: listToolSchemas(),
      };
    },
  },
  {
    name: "tools.schema",
    description: "Read one local Sume CLI or MCP tool contract by name.",
    inputSchema: toolNameInputSchema,
    annotations: readOnlyAnnotations("tools.schema"),
    readOnly: true,
    toolset: "tools",
    execute: async (input) => {
      const parsed = toolNameInputSchema.parse(input);
      const { getToolSchema } = await import("../lib/tool-registry.js");
      const schema = getToolSchema(parsed.name);
      if (!schema) {
        throw new CliError(`Unknown tool schema: ${parsed.name}`, {
          code: "tool_schema_not_found",
          hint: "Call tools.list to discover available tools.",
        });
      }
      return schema;
    },
  },
  {
    name: "health.service",
    description: "Check unversioned Sume API service health.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("health.service"),
    readOnly: true,
    toolset: "health",
    execute: (_input, client) => client.get("/../health"),
  },
  {
    name: "health.v1",
    description: "Check versioned Sume API health.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("health.v1"),
    readOnly: true,
    toolset: "health",
    execute: (_input, client) => client.get("/health"),
  },
  {
    name: "account.me",
    description: "Read account context for the configured Sume API key.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("account.me"),
    readOnly: true,
    toolset: "account",
    execute: (_input, client) => client.get("/me"),
  },
  {
    name: "balance.get",
    description: "Read available USD-denominated public API balance.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("balance.get"),
    readOnly: true,
    toolset: "account",
    execute: (_input, client) => client.get("/balance"),
  },
  {
    name: "usage.get",
    description: "Read recent public API usage ledger entries.",
    inputSchema: limitInputSchema,
    annotations: readOnlyAnnotations("usage.get"),
    readOnly: true,
    toolset: "account",
    execute: (input, client) => {
      const parsed = limitInputSchema.parse(input);
      return client.get("/usage", { query: { limit: parsed.limit } });
    },
  },
  {
    name: "catalog.list",
    description: "List public Sume API capabilities.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("catalog.list"),
    readOnly: true,
    toolset: "catalog",
    execute: (_input, client) => client.get("/catalog"),
  },
  {
    name: "jobs.list",
    description: "List jobs.",
    inputSchema: limitInputSchema,
    annotations: readOnlyAnnotations("jobs.list"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "jobs",
    execute: (input, client) => {
      const parsed = limitInputSchema.parse(input);
      return client.get("/jobs", { query: { limit: parsed.limit } });
    },
  },
  {
    name: "jobs.get",
    description: "Get one job by id.",
    inputSchema: jobIdInputSchema,
    annotations: readOnlyAnnotations("jobs.get"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "jobs",
    execute: (input, client) => {
      const parsed = jobIdInputSchema.parse(input);
      return client.get(`/jobs/${encodeURIComponent(parsed.job_id)}`);
    },
  },
  {
    name: "jobs.status",
    description: "Get queue-friendly job status and polling URLs.",
    inputSchema: jobIdInputSchema,
    annotations: readOnlyAnnotations("jobs.status"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "jobs",
    execute: (input, client) => {
      const parsed = jobIdInputSchema.parse(input);
      return client.get(`/jobs/${encodeURIComponent(parsed.job_id)}/status`);
    },
  },
  {
    name: "jobs.result",
    description: "Get a completed job result.",
    inputSchema: jobIdInputSchema,
    annotations: readOnlyAnnotations("jobs.result"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "jobs",
    execute: async (input, client) => {
      const parsed = jobIdInputSchema.parse(input);
      const result = await client.get(`/jobs/${encodeURIComponent(parsed.job_id)}/result`);
      return addAvatarSummaryIfPresent(result);
    },
  },
  {
    name: "jobs.events",
    description: "List sanitized lifecycle events for one job.",
    inputSchema: jobEventsInputSchema,
    annotations: readOnlyAnnotations("jobs.events"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "jobs",
    execute: (input, client) => {
      const parsed = jobEventsInputSchema.parse(input);
      return client.get(`/jobs/${encodeURIComponent(parsed.job_id)}/events`, {
        query: { limit: parsed.limit },
      });
    },
  },
  {
    name: "jobs.wait",
    description:
      "Poll one job status until it reaches a terminal state or the bounded timeout expires.",
    inputSchema: jobWaitInputSchema,
    annotations: readOnlyAnnotations("jobs.wait"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "jobs",
    execute: async (input, client) => {
      const parsed = jobWaitInputSchema.parse(input);
      const startedAt = Date.now();
      let pollCount = 0;
      let lastStatus = "unknown";
      let lastValue: unknown = null;

      while (true) {
        pollCount += 1;
        lastValue = await client.get(
          `/jobs/${encodeURIComponent(parsed.job_id)}/status`,
        );
        lastStatus = readJobStatus(lastValue);
        const elapsedMs = Date.now() - startedAt;
        if (isTerminalJobStatus(lastStatus)) {
          return {
            object: "job_wait",
            job_id: parsed.job_id,
            status: lastStatus,
            terminal: true,
            timed_out: false,
            poll_count: pollCount,
            elapsed_seconds: elapsedMs / 1000,
            value: lastValue,
          };
        }
        if (elapsedMs >= parsed.timeout_seconds * 1000) {
          return {
            object: "job_wait",
            job_id: parsed.job_id,
            status: lastStatus,
            terminal: false,
            timed_out: true,
            poll_count: pollCount,
            elapsed_seconds: elapsedMs / 1000,
            value: lastValue,
          };
        }
        await delay(
          Math.min(
            parsed.interval_seconds * 1000,
            parsed.timeout_seconds * 1000 - elapsedMs,
          ),
        );
      }
    },
  },
  {
    name: "jobs.cancel",
    description: "Cancel a queued or processing job.",
    inputSchema: jobCancelInputSchema,
    annotations: submitAnnotations("jobs.cancel"),
    readOnly: false,
    toolset: "jobs",
    execute: (input, client) => {
      const parsed = jobCancelInputSchema.parse(input);
      return client.post(`/jobs/${encodeURIComponent(parsed.job_id)}/cancel`, {}, {
        headers: { "Idempotency-Key": parsed.idempotency_key },
      });
    },
  },
  {
    name: "assets.list",
    description:
      "List advanced compatibility workspace-scoped input assets. Hidden from the default launch MCP server.",
    inputSchema: listAssetsInputSchema,
    annotations: readOnlyAnnotations("assets.list"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "assets",
    execute: (input, client) => {
      const parsed = listAssetsInputSchema.parse(input);
      return client.get("/assets", {
        query: {
          cursor: parsed.cursor,
          limit: parsed.limit,
          media_type: parsed.media_type,
          status: parsed.status,
        },
      });
    },
  },
  {
    name: "assets.get",
    description:
      "Get one advanced compatibility workspace-scoped input asset by id. Public responses omit registered source URLs.",
    inputSchema: assetIdInputSchema,
    annotations: readOnlyAnnotations("assets.get"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "assets",
    execute: (input, client) => {
      const parsed = assetIdInputSchema.parse(input);
      return client.get(`/assets/${encodeURIComponent(parsed.asset_id)}`);
    },
  },
  {
    name: "assets.upload_url",
    description:
      "Create a short-lived signed upload URL for an advanced compatibility workspace-scoped input asset. This is a write operation and returns a sensitive URL.",
    inputSchema: assetUploadUrlSubmitInputSchema,
    annotations: submitAnnotations("assets.upload_url"),
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "assets",
    execute: (input, client) => {
      const parsed = assetUploadUrlSubmitInputSchema.parse(input);
      return client.post("/assets/upload-url", parsed.payload, {
        headers: { "Idempotency-Key": parsed.idempotency_key },
      });
    },
  },
  {
    name: "assets.upload_file",
    description:
      "Upload one local file through the advanced compatibility asset workflow by creating a signed upload URL, PUTing bytes internally, and completing the asset without returning the signed URL.",
    inputSchema: assetUploadFileInputSchema,
    annotations: submitAnnotations("assets.upload_file"),
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "assets",
    execute: async (input, client) => {
      const parsed = assetUploadFileInputSchema.parse(input);
      const file = await readUploadFile(parsed.path);
      const filename = parsed.filename ?? basename(parsed.path);
      const uploadPayload = {
        ...(parsed.checksum_sha256
          ? { checksum_sha256: parsed.checksum_sha256.toLowerCase() }
          : {}),
        content_type: parsed.content_type,
        filename,
        ...(parsed.media_type ? { media_type: parsed.media_type } : {}),
        size_bytes: file.size,
      };
      const presign = await client.post("/assets/upload-url", uploadPayload, {
        headers: { "Idempotency-Key": parsed.idempotency_key },
      });
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

      const upload = await client.uploadToSignedUrl({
        url: uploadUrl,
        headers: uploadHeaders(presign, parsed.content_type),
        body: file.body,
      });
      const completePayload = {
        ...(parsed.checksum_sha256
          ? { checksum_sha256: parsed.checksum_sha256.toLowerCase() }
          : {}),
        size_bytes: file.size,
      };
      const completed = await client.post(
        `/assets/${encodeURIComponent(assetId)}/complete`,
        completePayload,
        { headers: { "Idempotency-Key": parsed.idempotency_key } },
      );

      return {
        object: "asset_file_upload",
        file: {
          filename,
          content_type: parsed.content_type,
          media_type: parsed.media_type ?? null,
          size_bytes: file.size,
        },
        asset_id: assetId,
        upload: {
          ok: true,
          status: record(upload).status ?? null,
        },
        asset: completed,
      };
    },
  },
  {
    name: "assets.complete",
    description:
      "Mark a direct-uploaded advanced compatibility input asset as complete.",
    inputSchema: assetUploadCompleteInputSchema,
    annotations: submitAnnotations("assets.complete"),
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "assets",
    execute: (input, client) => {
      const parsed = assetUploadCompleteInputSchema.parse(input);
      return client.post(
        `/assets/${encodeURIComponent(parsed.asset_id)}/complete`,
        parsed.payload,
        { headers: { "Idempotency-Key": parsed.idempotency_key } },
      );
    },
  },
  {
    name: "assets.download_url",
    description:
      "Create a short-lived signed download URL for a ready advanced compatibility first-party uploaded asset.",
    inputSchema: assetIdInputSchema,
    annotations: readOnlyAnnotations("assets.download_url"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "assets",
    execute: (input, client) => {
      const parsed = assetIdInputSchema.parse(input);
      return client.get(`/assets/${encodeURIComponent(parsed.asset_id)}/download-url`);
    },
  },
  {
    name: "assets.create",
    description:
      "Register a public HTTPS URL as an advanced compatibility workspace-scoped input asset. This is a write operation but not a paid generation call.",
    inputSchema: assetSubmitInputSchema,
    annotations: submitAnnotations("assets.create"),
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "assets",
    execute: (input, client) => {
      const parsed = assetSubmitInputSchema.parse(input);
      return client.post("/assets", parsed.payload, {
        headers: { "Idempotency-Key": parsed.idempotency_key },
      });
    },
  },
  {
    name: "avatars.list",
    description: "List Sume avatar resources.",
    inputSchema: avatarListInputSchema,
    annotations: readOnlyAnnotations("avatars.list"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "avatars",
    execute: (input, client) => {
      const parsed = avatarListInputSchema.parse(input);
      return client.get("/avatars", {
        query: {
          handle: parsed.handle,
          limit: parsed.limit,
          status: parsed.status,
        },
      });
    },
  },
  {
    name: "avatars.get",
    description: "Get one Sume avatar resource by id.",
    inputSchema: avatarIdInputSchema,
    annotations: readOnlyAnnotations("avatars.get"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "avatars",
    execute: (input, client) => {
      const parsed = avatarIdInputSchema.parse(input);
      return client.get(`/avatars/${encodeURIComponent(parsed.avatar_id)}`);
    },
  },
  {
    name: "avatars.wait",
    description:
      "Poll one avatar generation job and return an avatar-focused result summary when terminal.",
    inputSchema: jobWaitInputSchema,
    annotations: readOnlyAnnotations("avatars.wait"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "avatars",
    execute: async (input, client) => {
      const parsed = jobWaitInputSchema.parse(input);
      const startedAt = Date.now();
      let pollCount = 0;
      let lastStatus = "unknown";
      let lastValue: unknown = null;

      while (true) {
        pollCount += 1;
        lastValue = await client.get(
          `/jobs/${encodeURIComponent(parsed.job_id)}/status`,
        );
        lastStatus = readJobStatus(lastValue);
        const elapsedMs = Date.now() - startedAt;
        if (isTerminalJobStatus(lastStatus)) {
          let result: unknown = null;
          try {
            result = await client.get(
              `/jobs/${encodeURIComponent(parsed.job_id)}/result`,
            );
          } catch (error) {
            result = {
              object: "avatar_wait_result_unavailable",
              message: asPublicErrorMessage(error),
            };
          }
          return {
            object: "avatar_wait",
            job_id: parsed.job_id,
            status: lastStatus,
            terminal: true,
            timed_out: false,
            poll_count: pollCount,
            elapsed_seconds: elapsedMs / 1000,
            value: lastValue,
            result,
            avatar_summary: summarizeAvatarGeneration(result ?? lastValue),
          };
        }
        if (elapsedMs >= parsed.timeout_seconds * 1000) {
          return {
            object: "avatar_wait",
            job_id: parsed.job_id,
            status: lastStatus,
            terminal: false,
            timed_out: true,
            poll_count: pollCount,
            elapsed_seconds: elapsedMs / 1000,
            value: lastValue,
            avatar_summary: summarizeAvatarGeneration(lastValue),
          };
        }
        await delay(
          Math.min(
            parsed.interval_seconds * 1000,
            parsed.timeout_seconds * 1000 - elapsedMs,
          ),
        );
      }
    },
  },
  {
    name: "avatars.create",
    description:
      "Submit an Avatar 1.0 model run to the public Sume API.",
    inputSchema: avatarSubmissionInputSchema,
    annotations: submitAnnotations("avatars.create"),
    paidProviderCall: true,
    providerRuntime: "api_runtime_configured",
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "avatars",
    execute: async (input, client) => {
      const parsed = readPaidGenerationInput(
        input,
        avatarSubmissionInputSchema,
        "avatars.create",
      );
      return submitAvatarGeneration({
        client,
        dryRun: parsed.dry_run,
        idempotencyKey: parsed.idempotency_key,
        maxSpendUsd: parsed.max_spend_usd,
        payload: parsed.payload,
        model: parsed.model,
        toolName: "avatars.create",
      });
    },
  },
  {
    name: "avatars.create_prompt",
    description:
      "Create an Avatar 1.0 avatar from a text prompt without requiring the raw API payload shape.",
    inputSchema: avatarCreatePromptInputSchema,
    annotations: submitAnnotations("avatars.create_prompt"),
    paidProviderCall: true,
    providerRuntime: "api_runtime_configured",
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "avatars",
    execute: async (input, client) => {
      const parsed = avatarCreatePromptInputSchema.parse(input);
      return submitAvatarGeneration({
        client,
        dryRun: parsed.dry_run,
        idempotencyKey: parsed.idempotency_key,
        maxSpendUsd: parsed.max_spend_usd,
        model: parsed.model,
        payload: avatarModelPayload(
          parsed.avatar_handle,
          {
            type: "prompt",
            prompt: parsed.prompt,
          },
          communicationOptions(parsed),
        ),
        toolName: "avatars.create_prompt",
      });
    },
  },
  {
    name: "avatars.create_props",
    description:
      "Create an Avatar 1.0 avatar from structured profile properties without requiring the raw API payload shape.",
    inputSchema: avatarCreatePropsInputSchema,
    annotations: submitAnnotations("avatars.create_props"),
    paidProviderCall: true,
    providerRuntime: "api_runtime_configured",
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "avatars",
    execute: async (input, client) => {
      const parsed = avatarCreatePropsInputSchema.parse(input);
      return submitAvatarGeneration({
        client,
        dryRun: parsed.dry_run,
        idempotencyKey: parsed.idempotency_key,
        maxSpendUsd: parsed.max_spend_usd,
        model: parsed.model,
        payload: avatarModelPayload(
          parsed.avatar_handle,
          {
            type: "props",
            ethnicity: parsed.ethnicity,
            sex: parsed.sex,
            age: parsed.age,
          },
          communicationOptions(parsed),
        ),
        toolName: "avatars.create_props",
      });
    },
  },
  {
    name: "avatars.create_photo_url",
    description:
      "Create an Avatar 1.0 avatar from a public image URL.",
    inputSchema: avatarCreatePhotoUrlInputSchema,
    annotations: submitAnnotations("avatars.create_photo_url"),
    paidProviderCall: true,
    providerRuntime: "api_runtime_configured",
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "avatars",
    execute: async (input, client) => {
      const parsed = avatarCreatePhotoUrlInputSchema.parse(input);
      return submitAvatarGeneration({
        client,
        dryRun: parsed.dry_run,
        idempotencyKey: parsed.idempotency_key,
        maxSpendUsd: parsed.max_spend_usd,
        model: parsed.model,
        payload: avatarModelPayload(
          parsed.avatar_handle,
          {
            type: "photo",
            image_url: parsed.image_url,
          },
          communicationOptions(parsed),
        ),
        toolName: "avatars.create_photo_url",
      });
    },
  },
  {
    name: "avatar-videos.list",
    description: "List Sume avatar video resources.",
    inputSchema: emptyInputSchema,
    annotations: readOnlyAnnotations("avatar-videos.list"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "avatar-videos",
    execute: (_input, client) => client.get("/avatar-videos"),
  },
  {
    name: "avatar-videos.get",
    description: "Get one Sume avatar video resource by id.",
    inputSchema: avatarVideoIdInputSchema,
    annotations: readOnlyAnnotations("avatar-videos.get"),
    returnsSensitiveUrl: true,
    readOnly: true,
    toolset: "avatar-videos",
    execute: (input, client) => {
      const parsed = avatarVideoIdInputSchema.parse(input);
      return client.get(
        `/avatar-videos/${encodeURIComponent(parsed.avatar_video_id)}`,
      );
    },
  },
  {
    name: "avatar-videos.create",
    description:
      "Submit an Avatar Video 1.0 model run to the public Sume API.",
    inputSchema: avatarVideoCreateInputSchema,
    annotations: submitAnnotations("avatar-videos.create"),
    paidProviderCall: true,
    providerRuntime: "api_runtime_configured",
    returnsSensitiveUrl: true,
    readOnly: false,
    toolset: "avatar-videos",
    execute: async (input, client) => {
      const parsed = readAvatarVideoCreateInput(input);
      const payload = buildAvatarVideoMcpPayload(parsed);
      assertAvatarVideoScriptDuration(payload);
      return submitPaidGeneration({
        client,
        endpoint: "/models/sume/avatar-video/v1.0/runs",
        idempotencyKey: parsed.idempotency_key,
        maxSpendUsd: parsed.max_spend_usd,
        model: AVATAR_VIDEO_MODEL_ID,
        payload,
        dryRun: parsed.dry_run,
        toolName: "avatar-videos.create",
      });
    },
  },
];

const AVATAR_VIDEO_FRIENDLY_FIELDS = [
  "aspect_ratio",
  "avatar_handle",
  "mode",
  "product_image",
  "quality",
  "resolution",
  "scene_image_url",
  "scene_prompt",
  "script",
  "title",
  "wait_timeout_seconds",
  "webhook_url",
] as const;

function readAvatarVideoCreateInput(input: unknown) {
  const candidate = record(input);
  if (Object.hasOwn(candidate, "background")) {
    throw new CliError("background is not supported; use scene_prompt or scene_image_url.", {
      code: "invalid_argument",
    });
  }
  for (const field of ["avatar_id", "voice_id", "ratio"]) {
    if (Object.hasOwn(candidate, field)) {
      throw new CliError(
        `${field} is not part of the launch Avatar Video MCP input. Use avatar_handle or aspect_ratio instead.`,
        { code: "invalid_argument" },
      );
    }
  }
  if (
    typeof candidate.idempotency_key !== "string" ||
    !candidate.idempotency_key.trim()
  ) {
    throw new CliError("avatar-videos.create requires idempotency_key.", {
      code: "missing_mcp_tool_argument",
    });
  }
  if (
    typeof candidate.max_spend_usd !== "number" ||
    !Number.isFinite(candidate.max_spend_usd)
  ) {
    throw new CliError("avatar-videos.create requires max_spend_usd.", {
      code: "missing_mcp_tool_argument",
    });
  }

  const hasPayload = Object.hasOwn(candidate, "payload");
  const hasFriendlyFields = AVATAR_VIDEO_FRIENDLY_FIELDS.some((field) =>
    Object.hasOwn(candidate, field),
  );
  if (hasPayload && hasFriendlyFields) {
    throw new CliError("Use either payload or friendly Avatar Video fields, not both.", {
      code: "invalid_argument",
    });
  }
  if (!hasPayload && !hasFriendlyFields) {
    throw new CliError("avatar-videos.create requires payload or friendly Avatar Video fields.", {
      code: "missing_mcp_tool_argument",
    });
  }

  return avatarVideoCreateInputSchema.parse(input);
}

function buildAvatarVideoMcpPayload(input: AvatarVideoCreateInput) {
  if (input.payload) return normalizeAvatarVideoExactPayload(input.payload);
  return buildAvatarVideoFriendlyPayload(input);
}

function buildAvatarVideoFriendlyPayload(input: AvatarVideoCreateInput) {
  if (!input.script) {
    throw new CliError("avatar-videos.create requires script.", {
      code: "missing_mcp_tool_argument",
    });
  }
  const avatarHandle = readAvatarVideoAvatarHandle(input.avatar_handle);
  const scene = readAvatarVideoScene(input.scene_prompt, input.scene_image_url);
  const payload: Record<string, unknown> = {
    avatar_handle: avatarHandle,
    script: input.script,
    quality: input.quality,
  };
  setOptional(payload, "product_image", input.product_image);
  setOptional(payload, "resolution", input.resolution);
  setOptional(payload, "aspect_ratio", input.aspect_ratio);
  setOptional(payload, "title", input.title);
  setOptional(payload, "mode", input.mode);
  setOptional(payload, "webhook_url", input.webhook_url);
  setOptional(payload, "wait_timeout_seconds", input.wait_timeout_seconds);
  setOptional(payload, "scene", scene);
  return payload;
}

function normalizeAvatarVideoExactPayload(payload: Record<string, unknown>) {
  const normalized = { ...payload };
  for (const field of [
    "avatar",
    "avatar_id",
    "voice_id",
    "ratio",
    "callback_url",
    "background",
  ]) {
    if (Object.hasOwn(normalized, field)) {
      throw new CliError(
        `${field} is not part of the launch Avatar Video model-run request.`,
        { code: "invalid_argument" },
      );
    }
  }
  if (!readOptionalString(normalized.avatar_handle)) {
    throw new CliError("payload.avatar_handle is required.", {
      code: "invalid_argument",
    });
  }

  const scenePrompt = readOptionalString(normalized.scene_prompt);
  const sceneImageUrl = readOptionalString(normalized.scene_image_url);
  if (scenePrompt || sceneImageUrl) {
    if (normalized.scene) {
      throw new CliError("Use either payload.scene or payload scene aliases, not both.", {
        code: "invalid_argument",
      });
    }
    normalized.scene = readAvatarVideoScene(scenePrompt, sceneImageUrl);
    delete normalized.scene_prompt;
    delete normalized.scene_image_url;
  }

  return normalized;
}

function readAvatarVideoAvatarHandle(avatarHandle: string | undefined) {
  if (!avatarHandle) {
    throw new CliError("avatar-videos.create requires avatar_handle.", {
      code: "invalid_argument",
    });
  }
  return avatarHandle;
}

function readAvatarVideoScene(
  scenePrompt: string | undefined,
  sceneImageUrl: string | undefined,
) {
  if (scenePrompt && sceneImageUrl) {
    throw new CliError("Use either scene_prompt or scene_image_url, not both.", {
      code: "invalid_argument",
    });
  }
  if (scenePrompt) return { type: "prompt", prompt: scenePrompt };
  if (sceneImageUrl) return { type: "photo", image_url: sceneImageUrl };
  return undefined;
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function setOptional(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value !== undefined) payload[key] = value;
}

function assertAvatarVideoScriptDuration(payload: Record<string, unknown>) {
  if (typeof payload.script !== "string") return;
  const validation = validateAvatarVideoScriptDuration(payload.script);
  if (!validation.ok) {
    throw new CliError(validation.message, { code: "invalid_argument" });
  }
}

export function selectMcpTools(options: McpToolFilterOptions = {}) {
  const requestedToolsets = new Set(options.toolsets ?? DEFAULT_MCP_TOOLSETS);
  return mcpTools.filter((tool) => {
    if (!requestedToolsets.has(tool.toolset)) {
      return false;
    }
    if (!tool.readOnly && !options.allowWrite) return false;
    if ((tool.futurePaidProviderCall || tool.paidProviderCall) && !options.allowPaid) {
      return false;
    }
    return true;
  });
}

export function listMcpTools(options: McpToolFilterOptions = {}) {
  return selectMcpTools(options).map((tool) => ({
    name: tool.name,
    description: tool.description,
    paid_generation_call: Boolean(tool.paidProviderCall),
    future_paid_generation_call: Boolean(tool.futurePaidProviderCall),
    generation_runtime:
      tool.providerRuntime === "api_runtime_configured" ? "sume_api" : "none",
    read_only: tool.readOnly,
    returns_sensitive_url: Boolean(tool.returnsSensitiveUrl),
    toolset: tool.toolset,
  }));
}

export function mcpNextStepsForTool(name: string) {
  if (name === "assets.create") {
    return [
      "Capture data.asset.id from the response.",
      "Read asset metadata later with MCP assets.get or sume assets get <asset_id> --agent --json.",
      "Do not echo raw asset URLs in agent reports.",
    ];
  }
  if (name === "assets.upload_url") {
    return [
      "Do not log or echo the signed upload URL.",
      "After uploading bytes, call assets.complete with the returned asset id.",
    ];
  }
  if (name === "assets.upload_file") {
    return [
      "The signed upload URL was used internally and redacted from this MCP response.",
      "Use assets.get to confirm the asset status later.",
      "Use ready asset ids as generation inputs only when the user explicitly asks.",
    ];
  }
  if (name === "assets.complete") {
    return [
      "Use assets.get to confirm the asset is ready.",
      "Use ready asset ids as generation inputs only when the user explicitly asks.",
    ];
  }
  if (name === "assets.download_url") {
    return [
      "Do not echo signed download URLs in agent reports.",
      "Use this only when the user explicitly asks for a short-lived download URL.",
    ];
  }
  if (name === "assets.get") {
    return [
      "Use asset metadata only for current public image/video API requests when the user explicitly asks.",
      "Do not echo raw asset URLs in agent reports.",
    ];
  }
  if (name === "avatars.wait") {
    return [
      "Use avatar_summary.avatar_id with avatars.get when present.",
      "Use avatar_summary.artifacts for public generated media URLs.",
      "If terminal is false, call avatars.wait again later or inspect jobs.events.",
    ];
  }
  if (name === "avatars.create" || name.startsWith("avatars.create_")) {
    return [
      "Use avatar_summary.job_id with avatars.wait to poll and read grouped artifacts.",
      "Use avatar_summary.avatar_id with avatars.get when present.",
      "Do not echo signed or private media URLs in agent reports.",
    ];
  }
  if (name.endsWith(".create")) {
    return [
      "This MCP response is agent-redacted. Capture request_id and job.id if present.",
      "Poll the job with MCP jobs.status or use the CLI command sume jobs watch <job_id> --agent --json.",
      "Read completed output with MCP jobs.result or sume jobs result <job_id> --agent --json.",
    ];
  }
  if (name === "jobs.status") {
    return [
      "If the job is not terminal, poll jobs.status again later or use sume jobs watch <job_id> --agent --json.",
      "After completion, call jobs.result for the sanitized result summary.",
    ];
  }
  if (name === "jobs.wait") {
    return [
      "If terminal is false, call jobs.wait again later or inspect jobs.events.",
      "After completion, call jobs.result for the sanitized result summary.",
    ];
  }
  if (name === "jobs.result") {
    return [
      "Do not echo raw signed or private media URLs in agent reports.",
      "Use explicit download tooling only when the user asks to save result assets locally.",
    ];
  }
  if (name.startsWith("jobs.")) {
    return [
      "Use jobs.status for a queue-friendly status snapshot.",
      "Use jobs.result only after the job reaches a terminal successful state.",
    ];
  }
  return ["Run sume doctor --agent --json if local readiness is unclear."];
}

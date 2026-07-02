import fs from "node:fs";
import path from "node:path";
import { createClient } from "./command.js";
import { CliError } from "./errors.js";
import { redactForAgent } from "./agent-output.js";
import { validateAvatarVideoScriptDuration } from "./avatar-video-duration.js";
import {
  AVATAR_VIDEO_QUALITY_VALUES,
  DEFAULT_AVATAR_VIDEO_QUALITY,
  type AvatarVideoQuality,
} from "./quality.js";

export type BatchKind = "avatar" | "avatar-video";

export type BatchPlanItem = {
  errors: string[];
  id: string;
  payload: Record<string, unknown> | null;
  ready: boolean;
};

export type BatchPlan = {
  count: number;
  items: BatchPlanItem[];
  object: "batch_plan";
  ready: boolean;
  workflow: BatchKind;
};

export type BatchStateItem = {
  error?: string;
  id: string;
  job_id?: string;
  last_result?: unknown;
  last_status?: string;
  request_id?: string;
  submitted_at?: string;
  updated_at?: string;
};

export type BatchState = {
  items: BatchStateItem[];
  object: "batch_state";
  updated_at: string;
  workflow: BatchKind;
};

export type BatchOptions = {
  manifestFile: string;
  stateFile?: string;
};

type Manifest = Record<string, unknown>;

export function planAvatarBatch(manifestFile: string): BatchPlan {
  const manifest = readJsonObject(manifestFile, "manifest");
  const defaults = record(manifest.defaults);
  const items = readManifestItems(manifest, "avatars").map((item, index) =>
    planAvatarItem(defaults, item, index),
  );
  return buildPlan("avatar", items);
}

export function planAvatarVideoBatch(manifestFile: string): BatchPlan {
  const manifest = readJsonObject(manifestFile, "manifest");
  const defaults = record(manifest.defaults);
  const items = readManifestItems(manifest, "videos").map((item, index) =>
    planAvatarVideoItem(defaults, item, index),
  );
  return buildPlan("avatar-video", items);
}

export async function submitBatch(
  plan: BatchPlan,
  options: BatchOptions & { idempotencyKeyPrefix?: string },
) {
  assertPlanReady(plan);
  const state = readState(options.stateFile, plan.workflow);
  const client = createClient();
  const endpoint =
    plan.workflow === "avatar"
      ? "/models/sume/avatar/v1.0/runs"
      : "/models/sume/avatar-video/v1.0/runs";

  for (const planItem of plan.items) {
    const existing = state.items.find((item) => item.id === planItem.id);
    if (existing?.job_id || existing?.request_id) continue;
    const result = await client.post(endpoint, planItem.payload, {
      headers: {
        "Idempotency-Key": batchIdempotencyKey(
          options.idempotencyKeyPrefix,
          plan.workflow,
          planItem.id,
        ),
      },
    });
    upsertStateItem(state, {
      id: planItem.id,
      job_id: readJobId(result),
      request_id: readRequestId(result),
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  writeState(statePath(options), state);
  return state;
}

export async function watchBatch(
  workflow: BatchKind,
  options: BatchOptions & { intervalSeconds?: number; timeoutSeconds?: number },
) {
  const state = readRequiredState(options.stateFile, workflow);
  const intervalMs = (options.intervalSeconds ?? 5) * 1000;
  const timeoutMs = (options.timeoutSeconds ?? 300) * 1000;
  const startedAt = Date.now();
  const client = createClient();
  let pollCount = 0;

  while (true) {
    pollCount += 1;
    for (const item of state.items) {
      const jobId = item.job_id ?? item.request_id;
      if (!jobId) continue;
      const value = await client.get(`/jobs/${encodeURIComponent(jobId)}/status`);
      item.last_status = readStatus(value);
      item.updated_at = new Date().toISOString();
    }
    state.updated_at = new Date().toISOString();
    writeState(statePath(options), state);

    if (state.items.every((item) => isTerminalStatus(item.last_status))) {
      return batchWatchOutput(state, pollCount, "terminal");
    }
    if (timeoutMs === 0 || intervalMs === 0 || Date.now() - startedAt >= timeoutMs) {
      return batchWatchOutput(state, pollCount, "timeout");
    }
    await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - startedAt))));
  }
}

export async function resultBatch(workflow: BatchKind, options: BatchOptions) {
  const state = readRequiredState(options.stateFile, workflow);
  const client = createClient();
  for (const item of state.items) {
    const jobId = item.job_id ?? item.request_id;
    if (!jobId) continue;
    try {
      const value = await client.get(`/jobs/${encodeURIComponent(jobId)}/result`);
      item.last_result = redactForAgent(value).value;
      item.updated_at = new Date().toISOString();
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
      item.updated_at = new Date().toISOString();
    }
  }
  state.updated_at = new Date().toISOString();
  writeState(statePath(options), state);
  return state;
}

export function statePath(options: BatchOptions) {
  return options.stateFile ?? `${options.manifestFile}.state.json`;
}

export function writeOptionalJson(filePath: string | undefined, value: unknown) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function planAvatarItem(
  defaults: Record<string, unknown>,
  item: Record<string, unknown>,
  index: number,
): BatchPlanItem {
  const merged = { ...defaults, ...item };
  const id = readString(merged.id) ?? `avatar-${index + 1}`;
  const errors: string[] = [];
  const type = readString(merged.type) ?? "prompt";
  const avatarHandle = readAvatarHandle(merged, errors);

  let input: Record<string, unknown> | null = null;
  if (type === "prompt") {
    const prompt = readString(merged.prompt);
    if (!prompt) errors.push("prompt is required for prompt avatars");
    input = { type, prompt };
  } else if (type === "photo") {
    const imageUrl =
      readString(merged.image_url) ?? readString(merged.imageUrl);
    if (!imageUrl) errors.push("image_url is required for photo avatars");
    if ("file_url" in merged || "fileUrl" in merged || "file" in merged) {
      errors.push("use image_url for photo avatars; file/file_url is not supported");
    }
    input = { type, image_url: imageUrl };
  } else if (type === "props") {
    const ethnicity = readString(merged.ethnicity);
    const sex = readString(merged.sex);
    const age = readNumber(merged.age);
    if (!ethnicity) errors.push("ethnicity is required for props avatars");
    if (sex !== "male" && sex !== "female") {
      errors.push("sex must be male or female for props avatars");
    }
    if (age === undefined || !Number.isInteger(age) || age < 20 || age > 80) {
      errors.push("age must be an integer between 20 and 80 for props avatars");
    }
    input = { type, ethnicity, sex, age };
  } else {
    errors.push("type must be prompt, photo, or props");
  }
  if ("name" in merged) errors.push("name is not supported; use avatar_handle");
  if ("video" in merged) {
    errors.push("nested video is not supported; use avatar-video batch manifests");
  }

  return {
    id,
    errors,
    ready: errors.length === 0,
    payload:
      errors.length === 0 && input && avatarHandle
        ? { avatar_handle: avatarHandle, input }
        : null,
  };
}

function planAvatarVideoItem(
  defaults: Record<string, unknown>,
  item: Record<string, unknown>,
  index: number,
): BatchPlanItem {
  const merged = { ...defaults, ...item };
  const id = readString(merged.id) ?? `avatar-video-${index + 1}`;
  const errors: string[] = [];
  const rawScript = merged.script;
  const script = readString(merged.script);
  const productImage =
    readString(merged.product_image) ?? readString(merged.productImage);
  const avatarHandle =
    readString(merged.avatar_handle) ??
    readString(merged.avatarHandle);
  const quality = readString(merged.quality) ?? DEFAULT_AVATAR_VIDEO_QUALITY;
  if (quality && !isAvatarVideoQuality(quality)) {
    errors.push("quality must be standard, plus, or max");
  }
  if (!script) {
    const validation =
      typeof rawScript === "string"
        ? validateAvatarVideoScriptDuration(rawScript)
        : null;
    errors.push(
      validation && !validation.ok ? validation.message : "script is required",
    );
  } else {
    const validation = validateAvatarVideoScriptDuration(script);
    if (!validation.ok) errors.push(validation.message);
  }
  if (!avatarHandle) {
    errors.push("avatar_handle is required");
  }
  if ("avatar_id" in merged || "avatarId" in merged || "avatar" in merged) {
    errors.push("avatar_id/avatar wrappers are not supported; use avatar_handle");
  }
  const scenePrompt = readString(merged.scene_prompt) ?? readString(merged.scenePrompt);
  const sceneImageUrl =
    readString(merged.scene_image_url) ?? readString(merged.sceneImageUrl);
  if (scenePrompt && sceneImageUrl) {
    errors.push("scene_prompt and scene_image_url are mutually exclusive");
  }
  if ("background" in merged) {
    errors.push("background is not supported; use scene_prompt or scene_image_url");
  }
  if ("ratio" in merged) {
    errors.push("ratio is not supported; use aspect_ratio");
  }
  if ("voice_id" in merged || "voiceId" in merged) {
    errors.push("voice_id is not supported; avatar voice is selected internally");
  }

  const payload: Record<string, unknown> = {
    avatar_handle: avatarHandle,
    script,
    quality,
  };
  setOptional(payload, "product_image", productImage);
  setOptional(payload, "resolution", readString(merged.resolution));
  setOptional(
    payload,
    "aspect_ratio",
    readString(merged.aspect_ratio) ?? readString(merged.aspectRatio),
  );
  setOptional(payload, "title", readString(merged.title));
  if (scenePrompt) payload.scene = { type: "prompt", prompt: scenePrompt };
  if (sceneImageUrl) payload.scene = { type: "photo", image_url: sceneImageUrl };

  return {
    id,
    errors,
    ready: errors.length === 0,
    payload: errors.length === 0 ? payload : null,
  };
}

function isAvatarVideoQuality(value: string): value is AvatarVideoQuality {
  return AVATAR_VIDEO_QUALITY_VALUES.includes(value as AvatarVideoQuality);
}

function readAvatarHandle(
  value: Record<string, unknown>,
  errors: string[],
) {
  const handle =
    readString(value.avatar_handle) ??
    readString(value.avatarHandle) ??
    readString(value.handle);
  if (!handle) errors.push("avatar_handle is required");
  return handle;
}

function buildPlan(workflow: BatchKind, items: BatchPlanItem[]): BatchPlan {
  assertUniqueIds(items);
  return {
    object: "batch_plan",
    workflow,
    count: items.length,
    ready: items.every((item) => item.ready),
    items,
  };
}

function assertPlanReady(plan: BatchPlan) {
  if (plan.ready) return;
  throw new CliError("Batch manifest is not ready. Run plan and fix item errors.", {
    code: "invalid_batch_manifest",
  });
}

function readJsonObject(filePath: string, label: string): Manifest {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new CliError(`Unable to read ${label} file: ${filePath}`, {
      code: "invalid_argument",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`${label} file must be valid JSON.`, {
      code: "invalid_argument",
    });
  }
  const value = record(parsed);
  if (!Object.keys(value).length) {
    throw new CliError(`${label} file must be a JSON object.`, {
      code: "invalid_argument",
    });
  }
  return value;
}

function readManifestItems(manifest: Manifest, key: "avatars" | "videos") {
  const items = manifest[key];
  if (!Array.isArray(items) || items.length === 0) {
    throw new CliError(`${key} must be a non-empty array.`, {
      code: "invalid_argument",
    });
  }
  return items.map(record);
}

function readState(filePath: string | undefined, workflow: BatchKind): BatchState {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      object: "batch_state",
      workflow,
      updated_at: new Date().toISOString(),
      items: [],
    };
  }
  const parsed = readJsonObject(filePath, "state");
  if (parsed.workflow !== workflow) {
    throw new CliError(`state workflow must be ${workflow}.`, {
      code: "invalid_argument",
    });
  }
  return {
    object: "batch_state",
    workflow,
    updated_at: readString(parsed.updated_at) ?? new Date().toISOString(),
    items: Array.isArray(parsed.items) ? parsed.items.map(readStateItem) : [],
  };
}

function readRequiredState(filePath: string | undefined, workflow: BatchKind) {
  if (!filePath) {
    throw new CliError("--state-file is required.", { code: "invalid_argument" });
  }
  return readState(filePath, workflow);
}

function readStateItem(value: unknown): BatchStateItem {
  const item = record(value);
  return {
    id: readString(item.id) ?? "unknown",
    job_id: readString(item.job_id),
    request_id: readString(item.request_id),
    last_status: readString(item.last_status),
    submitted_at: readString(item.submitted_at),
    updated_at: readString(item.updated_at),
    error: readString(item.error),
    last_result: item.last_result,
  };
}

function writeState(filePath: string, state: BatchState) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function upsertStateItem(state: BatchState, next: BatchStateItem) {
  const index = state.items.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    state.items[index] = { ...state.items[index], ...next };
  } else {
    state.items.push(next);
  }
  state.updated_at = new Date().toISOString();
}

function batchWatchOutput(
  state: BatchState,
  pollCount: number,
  status: "terminal" | "timeout",
) {
  const completedCount = state.items.filter((item) =>
    isCompletedStatus(item.last_status),
  ).length;
  const failedCount = state.items.filter((item) =>
    isFailedStatus(item.last_status),
  ).length;
  return {
    object: "batch_watch",
    workflow: state.workflow,
    status,
    terminal: state.items.every((item) => isTerminalStatus(item.last_status)),
    watched_count: state.items.length,
    completed_count: completedCount,
    failed_count: failedCount,
    active_count: state.items.length - completedCount - failedCount,
    poll_count: pollCount,
    items: state.items,
  };
}

function batchIdempotencyKey(
  prefix: string | undefined,
  workflow: BatchKind,
  itemId: string,
) {
  return `${prefix ?? `sume-${workflow}-batch`}:${itemId}`;
}

function readJobId(value: unknown) {
  const data = record(record(value).data);
  const job = record(data.job ?? record(value).job);
  return (
    readString(data.job_id) ??
    readString(data.request_id) ??
    readString(data.id) ??
    readString(job.id) ??
    readString(job.job_id) ??
    readString(job.request_id)
  );
}

function readRequestId(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  return readString(root.request_id) ?? readString(data.request_id);
}

function readStatus(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  const job = record(data.job ?? root.job);
  return (
    readString(root.status) ??
    readString(data.status) ??
    readString(data.sume_status) ??
    readString(job.status) ??
    "unknown"
  );
}

function assertUniqueIds(items: BatchPlanItem[]) {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      item.errors.push("id must be unique within the manifest");
      item.ready = false;
      item.payload = null;
    }
    seen.add(item.id);
  }
}

function setOptional(payload: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value === "string" && value.trim()) payload[key] = value.trim();
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isTerminalStatus(status: string | undefined) {
  return isCompletedStatus(status) || isFailedStatus(status);
}

function isCompletedStatus(status: string | undefined) {
  return ["complete", "completed", "success", "succeeded"].includes(
    normalizeStatus(status),
  );
}

function isFailedStatus(status: string | undefined) {
  return ["canceled", "cancelled", "error", "errored", "failed"].includes(
    normalizeStatus(status),
  );
}

function normalizeStatus(status: string | undefined) {
  return (status ?? "").trim().toLowerCase();
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

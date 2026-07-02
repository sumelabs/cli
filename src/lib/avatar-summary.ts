export type AvatarArtifactSummary = {
  kind: string;
  content_type: string | null;
  public_url: string | null;
};

export type AvatarUsageSummary = {
  captured_usd: number | null;
  estimated_usd: number | null;
  refunded_or_released_usd: number | null;
  reserved_usd: number | null;
  state: string;
};

export type AvatarGenerationSummary = {
  object: "avatar_generation_summary";
  artifacts: AvatarArtifactSummary[];
  avatar_id: string | null;
  handle: string | null;
  job_id: string | null;
  next_tools: {
    avatar: string | null;
    result: string | null;
    status: string | null;
    wait: string | null;
  };
  status: string | null;
  usage: AvatarUsageSummary;
};

export function summarizeAvatarGeneration(
  value: unknown,
  options: { requestedAvatar?: unknown } = {},
): AvatarGenerationSummary {
  const avatarId = findFirst(value, isAvatarId);
  const jobId = findFirst(value, isJobId);
  const handle =
    findStringByKey(value, ["handle"]) ??
    findStringByKey(options.requestedAvatar, ["handle"]) ??
    null;

  return {
    object: "avatar_generation_summary",
    artifacts: summarizeAvatarArtifacts(value),
    avatar_id: avatarId,
    handle,
    job_id: jobId,
    next_tools: {
      avatar: avatarId ? `avatars.get { "avatar_id": "${avatarId}" }` : null,
      result: jobId ? `jobs.result { "job_id": "${jobId}" }` : null,
      status: jobId ? `jobs.status { "job_id": "${jobId}" }` : null,
      wait: jobId ? `avatars.wait { "job_id": "${jobId}" }` : null,
    },
    status: readStatus(value),
    usage: summarizeUsage(value),
  };
}

export function summarizeAvatarArtifacts(value: unknown): AvatarArtifactSummary[] {
  const artifacts = new Map<string, AvatarArtifactSummary>();

  for (const artifact of collectArtifactRecords(value)) {
    const kind = normalizeArtifactKind(
      firstStringFromRecord(artifact, ["kind", "stage", "name", "id", "type"]),
    );
    if (!kind) continue;
    const publicUrl = readSafePublicUrl(artifact);
    const contentType =
      firstStringFromRecord(artifact, ["content_type", "mime_type"]) ?? null;
    const existing = artifacts.get(kind);
    artifacts.set(kind, {
      kind,
      content_type: existing?.content_type ?? contentType,
      public_url: existing?.public_url ?? publicUrl,
    });
  }

  for (const [kind, path] of [
    ["avatar_base", ["idle_assets", "base_avatar"]],
    ["idle_still", ["idle_assets", "idle_still"]],
    ["idle_video", ["idle_assets", "idle_video"]],
    ["background_removed_video", ["idle_assets", "background_removed_video"]],
    ["idle_loop", ["idle_assets", "idle_loop"]],
  ] as const) {
    const record = findRecordAtPath(value, path);
    if (!record || artifacts.has(kind)) continue;
    artifacts.set(kind, {
      kind,
      content_type: firstStringFromRecord(record, ["content_type", "mime_type"]) ?? null,
      public_url: readSafePublicUrl(record),
    });
  }

  return [...artifacts.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

export function summarizeUsage(value: unknown): AvatarUsageSummary {
  const usage = findUsageRecord(value);
  if (!usage) {
    return {
      captured_usd: null,
      estimated_usd: null,
      refunded_or_released_usd: null,
      reserved_usd: null,
      state: "unavailable",
    };
  }

  const billable =
    readMicros(usage, ["billable_amount_usd_micros", "amount_usd_micros"]) ??
    readCents(usage, ["billable_amount_usd_cents", "amount_usd_cents"]);
  const state =
    firstStringFromRecord(usage, ["usage_status", "status", "state"]) ?? "estimated";
  const estimated =
    readMicros(usage, [
      "estimated_amount_usd_micros",
      "provider_estimated_cost_usd_micros",
      "estimated_usd_micros",
    ]) ?? readCents(usage, ["estimated_amount_usd_cents", "estimated_usd_cents"]);
  const captured =
    readMicros(usage, ["captured_amount_usd_micros"]) ??
    readCents(usage, ["captured_amount_usd_cents"]) ??
    (state === "captured" ? billable : undefined);
  const refunded =
    readMicros(usage, [
      "refunded_amount_usd_micros",
      "released_amount_usd_micros",
    ]) ??
    readCents(usage, [
      "refunded_amount_usd_cents",
      "released_amount_usd_cents",
    ]) ??
    (state === "refunded" || state === "released" ? billable : undefined);
  const reserved =
    readMicros(usage, ["reserved_amount_usd_micros"]) ??
    readCents(usage, ["reserved_amount_usd_cents"]) ??
    (state === "reserved" ? billable : undefined);

  return {
    captured_usd: toUsd(captured),
    estimated_usd: toUsd(estimated ?? billable),
    refunded_or_released_usd: toUsd(refunded),
    reserved_usd: toUsd(reserved),
    state,
  };
}

function collectArtifactRecords(value: unknown) {
  const records: Array<Record<string, unknown>> = [];
  walk(value, (node, key) => {
    if (!Array.isArray(node)) return;
    if (!["artifacts", "artifact"].includes(key ?? "")) return;
    for (const item of node) {
      const record = asRecord(item);
      if (record) records.push(record);
    }
  });
  return records;
}

function findRecordAtPath(value: unknown, suffix: readonly string[]) {
  let found: Record<string, unknown> | null = null;
  walk(value, (node, _key, path) => {
    if (found) return;
    if (!asRecord(node)) return;
    const currentPath = path ?? [];
    if (currentPath.length < suffix.length) return;
    const tail = currentPath.slice(currentPath.length - suffix.length);
    if (tail.every((part, index) => part === suffix[index])) {
      found = node as Record<string, unknown>;
    }
  });
  return found;
}

function findUsageRecord(value: unknown) {
  let found: Record<string, unknown> | null = null;
  walk(value, (node) => {
    if (found) return;
    const record = asRecord(node);
    if (!record) return;
    if (
      [
        "amount_usd_cents",
        "amount_usd_micros",
        "billable_amount_usd_cents",
        "billable_amount_usd_micros",
        "captured_amount_usd_micros",
        "estimated_amount_usd_micros",
        "provider_estimated_cost_usd_micros",
        "refunded_amount_usd_micros",
        "reserved_amount_usd_micros",
        "usage_status",
      ].some((key) => key in record)
    ) {
      found = record;
    }
  });
  return found;
}

function findFirst(value: unknown, predicate: (value: string) => boolean) {
  let found: string | null = null;
  walk(value, (node) => {
    if (found) return;
    if (typeof node === "string" && predicate(node)) found = node;
  });
  return found;
}

function findStringByKey(value: unknown, keys: string[]) {
  let found: string | null = null;
  walk(value, (node, key) => {
    if (found) return;
    if (!key || !keys.includes(key)) return;
    if (typeof node === "string" && node.trim()) {
      found = node.trim();
    }
  });
  return found;
}

function readStatus(value: unknown) {
  for (const key of ["resource_status", "sume_status", "status", "job_status"]) {
    const status = findStringByKey(value, [key]);
    if (status) return status;
  }
  return null;
}

function normalizeArtifactKind(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "base_avatar") return "avatar_base";
  if (normalized === "background_removed") return "background_removed_video";
  if (
    [
      "avatar_base",
      "idle_still",
      "idle_video",
      "background_removed_video",
      "idle_loop",
    ].includes(normalized)
  ) {
    return normalized;
  }
  return normalized;
}

function readSafePublicUrl(record: Record<string, unknown>) {
  for (const key of ["public_url", "url", "image_url", "media_url"]) {
    const value = record[key];
    if (typeof value === "string" && isSafePublicMediaUrl(value)) return value;
  }
  return null;
}

export function isSafePublicMediaUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname !== "media.sume.com") return false;
  if (parsed.search || parsed.hash) return false;
  return parsed.pathname.startsWith("/artifacts/");
}

function firstStringFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readMicros(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readCents(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = readNumber(record[key]);
    if (value !== undefined) return value * 10_000;
  }
  return undefined;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toUsd(value: number | undefined) {
  return value === undefined ? null : value / 1_000_000;
}

function isAvatarId(value: string) {
  return /^avtr_[A-Za-z0-9_-]+$/u.test(value) || /^avatar_(?!generation$)[A-Za-z0-9_-]+$/u.test(value);
}

function isJobId(value: string) {
  return /^job_[A-Za-z0-9_-]+$/u.test(value);
}

function walk(
  value: unknown,
  visitor: (value: unknown, key?: string, path?: string[]) => void,
  key?: string,
  path: string[] = [],
) {
  visitor(value, key, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, String(index), [...path, String(index)]));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [entryKey, entryValue] of Object.entries(record)) {
    walk(entryValue, visitor, entryKey, [...path, entryKey]);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

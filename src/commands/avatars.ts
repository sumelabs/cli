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
import { CliError } from "../lib/errors.js";
import { renderResult } from "../lib/render.js";
import {
  AVATAR_MODEL_IDS,
  avatarModelRunEndpoint,
  normalizeAvatarModelId,
  type AvatarModelId,
} from "../lib/models.js";
import {
  planAvatarBatch,
  resultBatch,
  statePath,
  submitBatch,
  watchBatch,
  writeOptionalJson,
} from "../lib/batch-workflows.js";
import {
  appendCommunicationOptions,
  idempotencyHeaders,
  readCommunicationMode,
  requireSubmitConfirmation,
  submissionHuman,
  submissionTransform,
  type SubmissionOptions,
} from "./submit-helpers.js";
import { redactForAgent, withAgentMetadata } from "../lib/agent-output.js";

type AvatarCreateOptions = SubmissionOptions & {
  age?: string;
  avatarHandle?: string;
  ethnicity?: string;
  handle?: string;
  imageUrl?: string;
  model?: string;
  payloadFile?: string;
  payloadJson?: string;
  prompt?: string;
  sex?: string;
  type?: string;
};

type AvatarReadOptions = {
  agent?: boolean;
  redactUrls?: boolean;
};

type AvatarListOptions = AvatarReadOptions & {
  handle?: string;
  limit?: string;
  ready?: boolean;
  status?: string;
};

type AvatarBatchOptions = {
  idempotencyKeyPrefix?: string;
  intervalSeconds?: string;
  outputFile?: string;
  stateFile?: string;
  timeoutSeconds?: string;
  confirmSubmit?: boolean;
  confirmPaid?: boolean;
};

const AVATAR_LIST_STATUSES = [
  "ready",
  "queued",
  "processing",
  "completed",
  "failed",
  "canceled",
] as const;

type AvatarListStatus = (typeof AVATAR_LIST_STATUSES)[number];

const AVATAR_PROPS_ETHNICITIES = [
  "Asian",
  "South Asian",
  "Southeast Asian",
  "Black",
  "Hispanic",
  "Middle Eastern",
  "White",
  "Wasian",
] as const;

type AvatarPropsEthnicity = (typeof AVATAR_PROPS_ETHNICITIES)[number];

export function registerAvatarsCommand(program: Command) {
  const avatars = program
    .command("avatars")
    .description("Create and inspect Sume avatar resources.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  avatars
    .command("list")
    .description("List avatar resources.")
    .option("--handle <handle>", "Filter by avatar handle, with or without @.")
    .option("--limit <n>", "Maximum number of avatars, 1-100.", "20")
    .option(
      "--status <status>",
      "Filter by status: ready, queued, processing, completed, failed, or canceled.",
    )
    .option("--ready", "Shortcut for --status ready.")
    .option("--agent", "Return agent-safe redacted avatar summaries.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(async (options: AvatarListOptions, command: Command) => {
      const endpoint = "/avatars";
      const limit = optionalIntegerInRange(options.limit, "limit", {
        min: 1,
        max: 100,
      });
      const status = readAvatarListStatus(options);
      const handle = optionalString(options.handle);
      const result = await createClient().get(endpoint, {
        query: { handle, limit, status },
      });
      renderResult(result, {
        json: getMode(command).json,
        transform: avatarReadOutput(result, options, "list"),
        human: avatarListHuman(endpoint, { handle, limit, status }, result),
      });
    });

  avatars
    .command("get")
    .description("Get one avatar resource.")
    .argument("<avatar_id>", "Avatar id.")
    .option("--agent", "Return an agent-safe redacted avatar.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(async (avatarId: string, options: AvatarReadOptions, command: Command) => {
      const normalizedAvatarId = requireString(avatarId, "avatar_id");
      const endpoint = `/avatars/${encodeURIComponent(normalizedAvatarId)}`;
      const result = await createClient().get(endpoint);
      renderResult(result, {
        json: getMode(command).json,
        transform: avatarReadOutput(result, options, "get"),
        human: avatarGetHuman(`/avatars/${normalizedAvatarId}`, result),
      });
    });

  avatars
    .command("create")
    .description("Submit an avatar creation job.")
    .option("--payload-json <json>", "Exact API request body as JSON.")
    .option("--payload-file <path>", "Read exact API request body from a JSON file.")
    .option(
      "--model <model>",
      `Public Avatar model id: ${AVATAR_MODEL_IDS.base}.`,
    )
    .option("--type <type>", "Avatar request type: prompt, photo, or props.", "prompt")
    .option(
      "--avatar-handle <handle>",
      "Desired public avatar handle, with or without @.",
    )
    .option("--handle <handle>", "Alias for --avatar-handle.")
    .option("--prompt <prompt>", "Prompt text for --type prompt.")
    .option(
      "--image-url <url>",
      "Source image URL for --type photo.",
    )
    .option(
      "--ethnicity <ethnicity>",
      "Ethnicity for --type props: Asian, South Asian, Southeast Asian, Black, Hispanic, Middle Eastern, White, or Wasian.",
    )
    .option("--sex <sex>", "Sex for --type props: male or female.")
    .option("--age <n>", "Age for --type props.")
    .option("--mode <mode>", "Communication mode: async, sync, subscribe, or webhook.")
    .option("--webhook-url <url>", "Public HTTPS callback URL for webhook mode.")
    .option("--wait-timeout-seconds <n>", "Sync wait budget, 0-30 seconds.")
    .option("--idempotency-key <key>", "Idempotency-Key request header.")
    .option(
      "--confirm-submit",
      "Confirm the user approved creating or queueing this job.",
    )
    .option(
      "--confirm-paid",
      "Alias for --confirm-submit for paid generation execution.",
    )
    .action(async (options: AvatarCreateOptions, command: Command) => {
      const exactPayload = optionalJsonObject(options);
      const client = createClient();
      const payload = exactPayload ?? buildAvatarRunPayloadFromOptions(options);
      assertCleanAvatarRunPayload(payload);
      appendCommunicationOptions(payload, {
        mode: readCommunicationMode(options.mode),
        webhookUrl: optionalString(options.webhookUrl),
        waitTimeout: optionalIntegerInRange(
          options.waitTimeoutSeconds,
          "wait-timeout-seconds",
          { min: 0, max: 30 },
        ),
      });
      requireSubmitConfirmation(options);

      const modelId = readAvatarModelId(options);
      const endpoint = avatarModelRunEndpoint(modelId);
      const result = await client.post(endpoint, payload, {
        headers: idempotencyHeaders(options),
      });
      renderResult(result, {
        json: getMode(command).json,
        human: submissionHuman("Avatar", endpoint, result),
        transform: submissionTransform(result, options),
      });
    });

  const batch = avatars
    .command("batch")
    .description("Plan, submit, watch, and read local avatar batch state files.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "plan" }),
    );

  batch
    .command("plan")
    .description("Validate an avatar batch manifest without API or live generation calls.")
    .argument("<manifest_file>", "Avatar batch manifest JSON file.")
    .option("--output-file <path>", "Optional path to write the plan JSON.")
    .action((manifestFile: string, options: AvatarBatchOptions, command: Command) => {
      const plan = planAvatarBatch(manifestFile);
      writeOptionalJson(options.outputFile, plan);
      renderResult(plan, {
        json: getMode(command).json,
        human: batchHuman("Avatar batch plan.", plan),
      });
    });

  batch
    .command("create")
    .description("Submit ready avatar batch items and write a local state file.")
    .argument("<manifest_file>", "Avatar batch manifest JSON file.")
    .option("--state-file <path>", "State file to write.", undefined)
    .option("--idempotency-key-prefix <key>", "Stable prefix for per-item idempotency keys.")
    .option("--confirm-submit", "Confirm the user approved creating or queueing these jobs.")
    .option("--confirm-paid", "Confirm the user approved paid generation execution.")
    .action(async (manifestFile: string, options: AvatarBatchOptions, command: Command) => {
      if (!options.confirmPaid && !options.confirmSubmit) {
        throw new CliError(
          "Avatar batch create can queue paid generation jobs. Re-run with --confirm-paid after explicit user approval.",
          { code: "confirmation_required" },
        );
      }
      const plan = planAvatarBatch(manifestFile);
      const state = await submitBatch(plan, {
        manifestFile,
        stateFile: options.stateFile ?? `${manifestFile}.state.json`,
        idempotencyKeyPrefix: options.idempotencyKeyPrefix,
      });
      renderResult(state, {
        json: getMode(command).json,
        human: batchStateHuman("Avatar batch submitted.", statePath({
          manifestFile,
          stateFile: options.stateFile ?? `${manifestFile}.state.json`,
        }), state.items.length),
      });
    });

  batch
    .command("watch")
    .description("Poll jobs from an avatar batch state file.")
    .argument("<manifest_file>", "Avatar batch manifest JSON file.")
    .option("--state-file <path>", "State file to update.", undefined)
    .option("--interval-seconds <n>", "Seconds between polls.", "5")
    .option("--timeout-seconds <n>", "Maximum watch duration in seconds.", "300")
    .action(async (manifestFile: string, options: AvatarBatchOptions, command: Command) => {
      const output = await watchBatch("avatar", {
        manifestFile,
        stateFile: options.stateFile ?? `${manifestFile}.state.json`,
        intervalSeconds: optionalBatchSeconds(options.intervalSeconds, "interval-seconds"),
        timeoutSeconds: optionalBatchSeconds(options.timeoutSeconds, "timeout-seconds"),
      });
      renderResult(output, {
        json: getMode(command).json,
        human: [
          ["Watched avatars", output.watched_count],
          ["Terminal", output.terminal],
          ["Status", output.status],
        ],
      });
    });

  batch
    .command("result")
    .description("Fetch redacted job results for an avatar batch state file.")
    .argument("<manifest_file>", "Avatar batch manifest JSON file.")
    .option("--state-file <path>", "State file to update.", undefined)
    .action(async (manifestFile: string, options: AvatarBatchOptions, command: Command) => {
      const state = await resultBatch("avatar", {
        manifestFile,
        stateFile: options.stateFile ?? `${manifestFile}.state.json`,
      });
      renderResult(state, {
        json: getMode(command).json,
        human: batchStateHuman(
          "Avatar batch results updated.",
          statePath({ manifestFile, stateFile: options.stateFile ?? `${manifestFile}.state.json` }),
          state.items.length,
        ),
      });
    });
}

function avatarReadOutput(
  value: unknown,
  options: AvatarReadOptions,
  command: "get" | "list",
) {
  if (options.agent) {
    return withAgentMetadata(value, {
      nextSteps:
        command === "list"
          ? [
              "Use sume avatars get <avatar_id> --agent --json for details.",
              "Use a ready avatar handle with sume avatar-videos create --confirm-paid.",
            ]
          : [
              "Use ready avatar handles with sume avatar-videos create --confirm-paid.",
              "Use sume jobs status <job_id> --agent --json when the response includes a job id.",
            ],
    });
  }
  if (options.redactUrls) return redactForAgent(value).value;
  return undefined;
}

function buildAvatarPayloadFromOptions(options: AvatarCreateOptions) {
  const type = options.type ?? "prompt";
  if (type === "prompt") {
    return {
      type,
      prompt: requireString(options.prompt, "prompt"),
    };
  }
  if (type === "photo") {
    return {
      type,
      image_url: requireString(options.imageUrl, "image-url"),
    };
  }
  if (type === "props") {
    const age = optionalIntegerInRange(options.age, "age", {
      min: 20,
      max: 80,
    });
    if (age === undefined) {
      throw new CliError("age is required.", { code: "invalid_argument" });
    }
    return {
      type,
      ethnicity: readPropsEthnicity(options.ethnicity),
      sex: readSex(options.sex),
      age,
    };
  }
  throw new CliError("type must be prompt, photo, or props.", {
    code: "invalid_argument",
  });
}

function buildAvatarRunPayloadFromOptions(options: AvatarCreateOptions) {
  return {
    avatar_handle: readAvatarHandleOptions(options),
    input: buildAvatarPayloadFromOptions(options),
  };
}

function readAvatarHandleOptions(options: AvatarCreateOptions) {
  const avatarHandle = optionalString(options.avatarHandle);
  const handle = optionalString(options.handle);
  if (avatarHandle && handle && avatarHandle !== handle) {
    throw new CliError("Use either --avatar-handle or --handle, not both.", {
      code: "invalid_argument",
    });
  }
  const value = avatarHandle ?? handle;
  if (!value) {
    throw new CliError("avatar-handle is required.", {
      code: "invalid_argument",
    });
  }
  return value;
}

function assertCleanAvatarRunPayload(payload: Record<string, unknown>) {
  for (const field of [
    "avatar",
    "video",
    "callback_url",
    "name",
    "file",
    "file_url",
    "fileUrl",
  ]) {
    if (Object.hasOwn(payload, field)) {
      throw new CliError(
        `${field} is not part of the launch Avatar model-run request. Use avatar_handle and input instead.`,
        { code: "invalid_argument" },
      );
    }
  }
  const input = payload.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const field of ["file", "file_url", "fileUrl", "name"]) {
      if (Object.hasOwn(input, field)) {
        throw new CliError(
          `input.${field} is not part of the launch Avatar model-run request.`,
          { code: "invalid_argument" },
        );
      }
    }
  }
}

function readPropsEthnicity(value: string | undefined) {
  const ethnicity = requireString(value, "ethnicity");
  if (AVATAR_PROPS_ETHNICITIES.includes(ethnicity as AvatarPropsEthnicity)) {
    return ethnicity as AvatarPropsEthnicity;
  }
  throw new CliError(
    "ethnicity must be Asian, South Asian, Southeast Asian, Black, Hispanic, Middle Eastern, White, or Wasian.",
    { code: "invalid_argument" },
  );
}

function readAvatarModelId(options: AvatarCreateOptions): AvatarModelId {
  return normalizeAvatarModelId(options.model);
}

function readAvatarListStatus(options: AvatarListOptions) {
  if (options.ready && options.status && options.status !== "ready") {
    throw new CliError("Use either --ready or --status, not both.", {
      code: "invalid_argument",
    });
  }
  const status = options.ready ? "ready" : options.status;
  if (!status) return undefined;
  if (AVATAR_LIST_STATUSES.includes(status as AvatarListStatus)) {
    return status as AvatarListStatus;
  }
  throw new CliError(
    "status must be ready, queued, processing, completed, failed, or canceled.",
    { code: "invalid_argument" },
  );
}

function avatarListHuman(
  endpoint: string,
  filters: { handle?: string; limit?: number; status?: string },
  value: unknown,
) {
  const avatars = readAvatars(value).map(summarizeAvatar);
  return [
    "Avatars.",
    `Endpoint: ${endpoint}`,
    filters.handle ? `Handle: ${filters.handle}` : "",
    filters.limit ? `Limit: ${filters.limit}` : "",
    filters.status ? `Status: ${filters.status}` : "",
    "",
    avatars.length
      ? formatTable(
          ["ID", "Name", "Status", "Job", "Source", "Updated", "Artifacts"],
          avatars.map((avatar) => [
            avatar.id,
            avatar.name,
            avatar.status,
            avatar.job,
            avatar.source,
            avatar.updated,
            avatar.artifacts,
          ]),
        ).join("\n")
      : "No avatars returned.",
    "",
    "Next: use a ready avatar handle with sume avatar-videos create --avatar-handle <handle> --confirm-paid.",
  ].filter(Boolean);
}

function avatarGetHuman(endpoint: string, value: unknown) {
  const avatar = summarizeAvatar(readAvatar(value));
  return [
    "Avatar.",
    `Endpoint: ${endpoint}`,
    ["ID", avatar.id] as [string, unknown],
    ["Name", avatar.name] as [string, unknown],
    ["Status", avatar.status] as [string, unknown],
    ["Job", avatar.job] as [string, unknown],
    ["Source", avatar.source] as [string, unknown],
    ["Created", avatar.created] as [string, unknown],
    ["Updated", avatar.updated] as [string, unknown],
    ["Artifacts", avatar.artifacts] as [string, unknown],
    avatar.status === "ready" && avatar.handle
      ? `Next: sume avatar-videos create --avatar-handle ${avatar.handle} --confirm-paid ...`
      : "Next: wait until status is ready before using this avatar for avatar-videos create.",
  ];
}

function summarizeAvatar(value: Record<string, unknown>) {
  const job = readJob(value);
  const artifacts = readArtifactKinds(value);
  return {
    id: readStringField(value, ["id", "avatar_id"]) ?? "unknown",
    handle: readStringField(value, ["handle"])?.replace(/^@/u, ""),
    name:
      readStringField(value, ["handle", "name", "display_name", "title"]) ??
      "unnamed",
    status:
      readStringField(value, ["resource_status", "status"]) ??
      readStringField(job, ["status"]) ??
      "unknown",
    job: formatJobSummary(value, job),
    source:
      readStringField(value, ["source_type", "source", "type", "avatar_type"]) ??
      readStringField(record(value.avatar), ["type"]) ??
      "unknown",
    created: readStringField(value, ["created_at"]) ?? "unknown",
    updated:
      readStringField(value, ["completed_at", "ready_at", "updated_at"]) ??
      "unknown",
    artifacts: formatArtifactKinds(artifacts),
  };
}

function formatJobSummary(
  avatar: Record<string, unknown>,
  job: Record<string, unknown>,
) {
  const jobId =
    readStringField(avatar, ["job_id", "source_job_id", "request_id"]) ??
    readStringField(job, ["id", "job_id", "request_id"]);
  const jobStatus =
    readStringField(avatar, ["job_status"]) ?? readStringField(job, ["status"]);
  if (jobId && jobStatus) return `${jobId} (${jobStatus})`;
  return jobId ?? jobStatus ?? "unknown";
}

function readArtifactKinds(value: Record<string, unknown>) {
  const artifacts = value.artifacts;
  const kinds = new Set<string>();
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      const item = record(artifact);
      const kind = readStringField(item, ["stage", "kind", "type", "name", "id"]);
      if (kind) kinds.add(kind);
    }
  } else if (artifacts && typeof artifacts === "object") {
    for (const [key, item] of Object.entries(artifacts)) {
      if (item) kinds.add(key);
    }
  }
  if (
    readStringField(value, ["image_url", "preview_url", "media_url"]) &&
    !kinds.size
  ) {
    kinds.add("image");
  }
  return [...kinds].sort();
}

function formatArtifactKinds(kinds: string[]) {
  if (!kinds.length) return "none";
  if (kinds.length <= 4) return kinds.join(", ");
  return `${kinds.slice(0, 4).join(", ")} +${kinds.length - 4}`;
}

function readAvatars(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  const avatars = Array.isArray(data.avatars)
    ? data.avatars
    : Array.isArray(root.avatars)
      ? root.avatars
      : [];
  return avatars.map(record);
}

function readAvatar(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  return record(data.avatar ?? root.avatar ?? data);
}

function readJob(value: Record<string, unknown>) {
  const job = record(value.job);
  if (Object.keys(job).length) return job;
  return record(record(value.data).job);
}

function readStringField(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function formatTable(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...rows.map((row) => String(row[index] ?? "").length),
    ),
  );
  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => String(cell ?? "").padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [formatRow(headers), formatRow(widths.map((width) => "-".repeat(width))), ...rows.map(formatRow)];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readSex(value: string | undefined) {
  const normalized = requireString(value, "sex");
  if (normalized === "male" || normalized === "female") return normalized;
  throw new CliError("sex must be male or female.", {
    code: "invalid_argument",
  });
}

function batchHuman(
  label: string,
  plan: { count: number; ready: boolean; workflow: string },
) {
  return [
    label,
    ["Workflow", plan.workflow] as [string, unknown],
    ["Items", plan.count] as [string, unknown],
    ["Ready", plan.ready] as [string, unknown],
  ];
}

function batchStateHuman(label: string, filePath: string, count: number) {
  return [
    label,
    ["State file", filePath] as [string, unknown],
    ["Items", count] as [string, unknown],
  ];
}

function optionalBatchSeconds(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError(`${name} must be a non-negative number.`, {
      code: "invalid_argument",
    });
  }
  return parsed;
}

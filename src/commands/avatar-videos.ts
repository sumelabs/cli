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
  planAvatarVideoBatch,
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
import { validateAvatarVideoScriptDuration } from "../lib/avatar-video-duration.js";
import {
  DEFAULT_AVATAR_VIDEO_QUALITY,
  readAvatarVideoQuality,
} from "../lib/quality.js";

type AvatarVideoCreateOptions = SubmissionOptions & {
  avatarHandle?: string;
  aspectRatio?: string;
  payloadFile?: string;
  payloadJson?: string;
  productImage?: string;
  quality?: string;
  resolution?: string;
  sceneImageUrl?: string;
  scenePrompt?: string;
  script?: string;
  title?: string;
};

type AvatarVideoReadOptions = {
  agent?: boolean;
  redactUrls?: boolean;
};

type AvatarVideoBatchOptions = {
  confirmPaid?: boolean;
  confirmSubmit?: boolean;
  idempotencyKeyPrefix?: string;
  intervalSeconds?: string;
  outputFile?: string;
  stateFile?: string;
  timeoutSeconds?: string;
};

export function registerAvatarVideosCommand(program: Command) {
  const avatarVideos = program
    .command("avatar-videos")
    .description("Create and inspect Sume avatar video resources.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  avatarVideos
    .command("list")
    .description("List avatar video resources.")
    .option("--agent", "Return agent-safe redacted avatar video summaries.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(async (options: AvatarVideoReadOptions, command: Command) => {
      const endpoint = "/avatar-videos";
      const result = await createClient().get(endpoint);
      renderResult(result, {
        json: getMode(command).json,
        transform: avatarVideoReadOutput(result, options, "list"),
        human: [["Endpoint", endpoint]],
      });
    });

  avatarVideos
    .command("get")
    .description("Get one avatar video resource.")
    .argument("<avatar_video_id>", "Avatar video id.")
    .option("--agent", "Return an agent-safe redacted avatar video.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (
        avatarVideoId: string,
        options: AvatarVideoReadOptions,
        command: Command,
      ) => {
        const normalizedAvatarVideoId = requireString(
          avatarVideoId,
          "avatar_video_id",
        );
        const endpoint = `/avatar-videos/${encodeURIComponent(normalizedAvatarVideoId)}`;
        const result = await createClient().get(endpoint);
        renderResult(result, {
          json: getMode(command).json,
          transform: avatarVideoReadOutput(result, options, "get"),
          human: [["Endpoint", `/avatar-videos/${normalizedAvatarVideoId}`]],
        });
      },
    );

  avatarVideos
    .command("create")
    .description("Submit an avatar video job.")
    .option("--payload-json <json>", "Exact API request body as JSON.")
    .option("--payload-file <path>", "Read exact API request body from a JSON file.")
    .option("--script <script>", "Video script, estimated at 4-60 seconds.")
    .option("--product-image <url>", "Optional product/reference image URL.")
    .option("--avatar-handle <handle>", "Existing avatar handle, with or without @.")
    .option("--scene-prompt <prompt>", "Prompt scene description.")
    .option("--scene-image-url <url>", "Photo scene image URL.")
    .option("--resolution <resolution>", "Resolution. Current API accepts 720p.")
    .option(
      "--quality <quality>",
      "Avatar Video quality: standard, plus, or max.",
      DEFAULT_AVATAR_VIDEO_QUALITY,
    )
    .option("--aspect-ratio <ratio>", "Optional aspect ratio.")
    .option("--title <title>", "Optional title.")
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
    .action(async (options: AvatarVideoCreateOptions, command: Command) => {
      const payload =
        optionalJsonObject(options) ?? buildAvatarVideoPayloadFromOptions(options);
      assertCleanAvatarVideoPayload(payload);
      appendCommunicationOptions(payload, {
        mode: readCommunicationMode(options.mode),
        webhookUrl: optionalString(options.webhookUrl),
        waitTimeout: optionalIntegerInRange(
          options.waitTimeoutSeconds,
          "wait-timeout-seconds",
          { min: 0, max: 30 },
        ),
      });
      assertAvatarVideoScriptDuration(payload);
      requireSubmitConfirmation(options);

      const endpoint = "/models/sume/avatar-video/v1.0/runs";
      const result = await createClient().post(endpoint, payload, {
        headers: idempotencyHeaders(options),
      });
      renderResult(result, {
        json: getMode(command).json,
        human: submissionHuman("Avatar video", endpoint, result),
        transform: submissionTransform(result, options),
      });
    });

  const batch = avatarVideos
    .command("batch")
    .description("Plan, submit, watch, and read local avatar-video batch state files.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "plan" }),
    );

  batch
    .command("plan")
    .description("Validate an avatar-video batch manifest without API or live generation calls.")
    .argument("<manifest_file>", "Avatar-video batch manifest JSON file.")
    .option("--output-file <path>", "Optional path to write the plan JSON.")
    .action((manifestFile: string, options: AvatarVideoBatchOptions, command: Command) => {
      const plan = planAvatarVideoBatch(manifestFile);
      writeOptionalJson(options.outputFile, plan);
      renderResult(plan, {
        json: getMode(command).json,
        human: batchHuman("Avatar-video batch plan.", plan),
      });
    });

  batch
    .command("create")
    .description("Submit ready avatar-video batch items and write a local state file.")
    .argument("<manifest_file>", "Avatar-video batch manifest JSON file.")
    .option("--state-file <path>", "State file to write.", undefined)
    .option("--idempotency-key-prefix <key>", "Stable prefix for per-item idempotency keys.")
    .option("--confirm-submit", "Confirm the user approved creating or queueing these jobs.")
    .option("--confirm-paid", "Confirm the user approved paid generation execution.")
    .action(
      async (
        manifestFile: string,
        options: AvatarVideoBatchOptions,
        command: Command,
      ) => {
        if (!options.confirmPaid && !options.confirmSubmit) {
          throw new CliError(
            "Avatar-video batch create can queue paid generation jobs. Re-run with --confirm-paid after explicit user approval.",
            { code: "confirmation_required" },
          );
        }
        const plan = planAvatarVideoBatch(manifestFile);
        const state = await submitBatch(plan, {
          manifestFile,
          stateFile: options.stateFile ?? `${manifestFile}.state.json`,
          idempotencyKeyPrefix: options.idempotencyKeyPrefix,
        });
        renderResult(state, {
          json: getMode(command).json,
          human: batchStateHuman(
            "Avatar-video batch submitted.",
            statePath({
              manifestFile,
              stateFile: options.stateFile ?? `${manifestFile}.state.json`,
            }),
            state.items.length,
          ),
        });
      },
    );

  batch
    .command("watch")
    .description("Poll jobs from an avatar-video batch state file.")
    .argument("<manifest_file>", "Avatar-video batch manifest JSON file.")
    .option("--state-file <path>", "State file to update.", undefined)
    .option("--interval-seconds <n>", "Seconds between polls.", "5")
    .option("--timeout-seconds <n>", "Maximum watch duration in seconds.", "300")
    .action(
      async (
        manifestFile: string,
        options: AvatarVideoBatchOptions,
        command: Command,
      ) => {
        const output = await watchBatch("avatar-video", {
          manifestFile,
          stateFile: options.stateFile ?? `${manifestFile}.state.json`,
          intervalSeconds: optionalBatchSeconds(
            options.intervalSeconds,
            "interval-seconds",
          ),
          timeoutSeconds: optionalBatchSeconds(
            options.timeoutSeconds,
            "timeout-seconds",
          ),
        });
        renderResult(output, {
          json: getMode(command).json,
          human: [
            ["Watched avatar videos", output.watched_count],
            ["Terminal", output.terminal],
            ["Status", output.status],
          ],
        });
      },
    );

  batch
    .command("result")
    .description("Fetch redacted job results for an avatar-video batch state file.")
    .argument("<manifest_file>", "Avatar-video batch manifest JSON file.")
    .option("--state-file <path>", "State file to update.", undefined)
    .action(
      async (
        manifestFile: string,
        options: AvatarVideoBatchOptions,
        command: Command,
      ) => {
        const state = await resultBatch("avatar-video", {
          manifestFile,
          stateFile: options.stateFile ?? `${manifestFile}.state.json`,
        });
        renderResult(state, {
          json: getMode(command).json,
          human: batchStateHuman(
            "Avatar-video batch results updated.",
            statePath({
              manifestFile,
              stateFile: options.stateFile ?? `${manifestFile}.state.json`,
            }),
            state.items.length,
          ),
        });
      },
    );
}

function avatarVideoReadOutput(
  value: unknown,
  options: AvatarVideoReadOptions,
  command: "get" | "list",
) {
  if (options.agent) {
    return withAgentMetadata(value, {
      nextSteps:
        command === "list"
          ? [
              "Use sume avatar-videos get <avatar_video_id> --agent --json for details.",
              "Use sume jobs result <job_id> --agent --json when a completed job id is available.",
            ]
          : [
              "Use media.sume.com result URLs only when the user asks for the generated media link.",
              "Use sume jobs events <job_id> --agent --json for sanitized diagnostics when available.",
            ],
    });
  }
  if (options.redactUrls) return redactForAgent(value).value;
  return undefined;
}

function buildAvatarVideoPayloadFromOptions(options: AvatarVideoCreateOptions) {
  if (options.scenePrompt && options.sceneImageUrl) {
    throw new CliError("Use either --scene-prompt or --scene-image-url, not both.", {
      code: "invalid_argument",
    });
  }

  const payload: Record<string, unknown> = {
    avatar_handle: readAvatarVideoAvatarHandle(options),
    script: requireString(options.script, "script"),
    quality: readAvatarVideoQuality(options.quality),
  };

  setOptional(payload, "product_image", options.productImage);
  setOptional(payload, "resolution", readResolution(options.resolution));
  setOptional(payload, "aspect_ratio", options.aspectRatio);
  setOptional(payload, "title", options.title);

  if (options.scenePrompt) {
    payload.scene = {
      type: "prompt",
      prompt: requireString(options.scenePrompt, "scene-prompt"),
    };
  }
  if (options.sceneImageUrl) {
    payload.scene = {
      type: "photo",
      image_url: requireString(options.sceneImageUrl, "scene-image-url"),
    };
  }

  return payload;
}

function assertCleanAvatarVideoPayload(payload: Record<string, unknown>) {
  for (const field of [
    "avatar",
    "avatar_id",
    "voice_id",
    "ratio",
    "callback_url",
    "background",
  ]) {
    if (Object.hasOwn(payload, field)) {
      throw new CliError(
        `${field} is not part of the launch Avatar Video model-run request. Use avatar_handle, aspect_ratio, and URL fields instead.`,
        { code: "invalid_argument" },
      );
    }
  }
}

function readAvatarVideoAvatarHandle(options: AvatarVideoCreateOptions) {
  const handle = optionalString(options.avatarHandle);
  if (!handle) {
    throw new CliError("avatar-handle is required.", {
      code: "invalid_argument",
    });
  }
  return handle;
}

function assertAvatarVideoScriptDuration(payload: Record<string, unknown>) {
  if (typeof payload.script !== "string") return;
  const validation = validateAvatarVideoScriptDuration(payload.script);
  if (!validation.ok) {
    throw new CliError(validation.message, { code: "invalid_argument" });
  }
}

function readResolution(value: string | undefined) {
  if (!value) return undefined;
  if (value === "720p") return value;
  throw new CliError("resolution must be 720p.", {
    code: "invalid_argument",
  });
}

function setOptional(
  payload: Record<string, unknown>,
  key: string,
  value: string | undefined,
) {
  const normalized = optionalString(value);
  if (normalized) payload[key] = normalized;
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

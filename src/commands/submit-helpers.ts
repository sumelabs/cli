import { CliError } from "../lib/errors.js";
import { redactForAgent, withAgentMetadata } from "../lib/agent-output.js";
import { command, field, hint, ok, section, statusText } from "../lib/ui.js";

export const COMMUNICATION_MODES = ["async", "sync", "subscribe", "webhook"] as const;
export type CommunicationMode = (typeof COMMUNICATION_MODES)[number];

export type SubmissionOptions = {
  agent?: boolean;
  callbackUrl?: string;
  confirmPaid?: boolean;
  confirmSubmit?: boolean;
  idempotencyKey?: string;
  mode?: string;
  redactUrls?: boolean;
  webhookUrl?: string;
  waitTimeoutSeconds?: string;
};

export function readCommunicationMode(value: string | undefined) {
  if (!value) return undefined;
  if (COMMUNICATION_MODES.includes(value as CommunicationMode)) {
    return value as CommunicationMode;
  }
  throw new CliError("mode must be async, sync, subscribe, or webhook.", {
    code: "invalid_argument",
  });
}

export function appendCommunicationOptions(
  payload: Record<string, unknown>,
  options: {
    callbackUrl?: string;
    mode?: CommunicationMode;
    webhookUrl?: string;
    waitTimeout?: number;
  },
) {
  if (options.webhookUrl && options.callbackUrl) {
    throw new CliError("Use either --webhook-url or --callback-url, not both.", {
      code: "invalid_argument",
    });
  }
  if (options.mode) payload.mode = options.mode;
  if (options.webhookUrl) payload.webhook_url = options.webhookUrl;
  if (options.callbackUrl) payload.callback_url = options.callbackUrl;
  if (options.waitTimeout !== undefined) {
    payload.wait_timeout_seconds = options.waitTimeout;
  }
  if (options.mode === "webhook" && !options.webhookUrl && !options.callbackUrl) {
    throw new CliError("mode webhook requires --webhook-url or --callback-url.", {
      code: "invalid_argument",
    });
  }
}

export function idempotencyHeaders(options: SubmissionOptions) {
  return {
    "Idempotency-Key": options.idempotencyKey,
  };
}

export function requireSubmitConfirmation(options: SubmissionOptions) {
  if (options.confirmSubmit || options.confirmPaid) return;
  throw new CliError(
    "Submitting this request may create a queued job. Re-run with --confirm-submit after the user explicitly approves.",
    {
      code: "confirmation_required",
      hint: "Use --confirm-submit for job submission, or --confirm-paid when Sume generation is enabled.",
    },
  );
}

export function submissionHuman(
  kind: string,
  endpoint: string,
  value: unknown,
  options: { providerNote?: string } = {},
) {
  const root = record(value);
  const data = record(root.data);
  const job = record(data.job);
  return [
    ok(`${kind} submission accepted.`),
    options.providerNote
      ? hint(options.providerNote)
      : hint(
          "Provider execution depends on api.sume.com runtime configuration; watch the returned job for final status.",
        ),
    section("Request"),
    field("Endpoint", endpoint),
    data.request_id ? field("Request ID", data.request_id) : "",
    job.status ? field("Job status", statusText(String(job.status))) : "",
    data.status_url ? field("Status URL", data.status_url) : "",
    data.result_url ? field("Result URL", data.result_url) : "",
    hint(
      `Next: use ${command("sume jobs watch <job_id> --agent --json")}, then ${command("sume jobs result <job_id> --agent --json")}.`,
    ),
  ];
}

export function submissionTransform(value: unknown, options: SubmissionOptions) {
  if (options.agent) {
    return withAgentMetadata(value, {
      nextSteps: [
        "Capture data.job.id or data.request_id from the submit response.",
        "Use sume jobs watch <job_id> --agent --json to monitor the job.",
      "Use sume jobs result <job_id> --agent --json after the job completes.",
      "Do not echo raw result URLs in agent reports.",
      ],
    });
  }
  if (options.redactUrls) {
    return redactForAgent(value).value;
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

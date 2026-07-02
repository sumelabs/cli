import { Command } from "commander";
import {
  createClient,
  getMode,
  optionalPositiveInteger,
  requireString,
  showSubcommandHelp,
} from "../lib/command.js";
import { redactForAgent, withAgentMetadata } from "../lib/agent-output.js";
import { downloadMediaFromValue } from "../lib/download.js";
import { CliError } from "../lib/errors.js";
import { renderResult } from "../lib/render.js";

type AgentOutputOptions = {
  agent?: boolean;
  redactUrls?: boolean;
};

type WatchOptions = AgentOutputOptions & {
  ids?: string;
  intervalSeconds?: string;
  timeoutSeconds?: string;
};

type DownloadOptions = {
  filename?: string;
  outputDir: string;
};

export function registerJobsCommand(program: Command) {
  const jobs = program
    .command("jobs")
    .description("List and inspect Sume jobs.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  jobs
    .command("list")
    .description("List jobs.")
    .option("--limit <n>", "Maximum number of jobs.", "20")
    .option("--agent", "Return agent-safe redacted job summaries.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (options: { limit: string } & AgentOutputOptions, command: Command) => {
        const limit = optionalPositiveInteger(options.limit, "limit");
        const result = await createClient().get("/jobs", { query: { limit } });
        renderResult(result, {
          json: getMode(command).json,
          transform: jobOutput(result, options, "list"),
          human: [
            ["Endpoint", "/jobs"],
            ["Limit", limit],
          ],
        });
      },
    );

  jobs
    .command("get")
    .description("Get one job.")
    .argument("<job_id>", "Job id.")
    .option("--agent", "Return an agent-safe redacted job summary.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (jobId: string, options: AgentOutputOptions, command: Command) => {
        const normalizedJobId = requireString(jobId, "job_id");
        const result = await createClient().get(
          `/jobs/${encodeURIComponent(normalizedJobId)}`,
        );
        const endpoint = `/jobs/${normalizedJobId}`;
        renderResult(result, {
          json: getMode(command).json,
          transform: jobOutput(result, options, "get"),
          human: jobHuman("Job.", endpoint, result),
        });
      },
    );

  jobs
    .command("status")
    .description("Get queue-friendly job status.")
    .argument("<job_id>", "Job id.")
    .option("--agent", "Return an agent-safe redacted job status.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (jobId: string, options: AgentOutputOptions, command: Command) => {
        const normalizedJobId = requireString(jobId, "job_id");
        const endpoint = `/jobs/${encodeURIComponent(normalizedJobId)}/status`;
        const result = await createClient().get(endpoint);
        renderResult(result, {
          json: getMode(command).json,
          transform: jobOutput(result, options, "status"),
          human: jobHuman("Job status.", `/jobs/${normalizedJobId}/status`, result),
        });
      },
    );

  jobs
    .command("result")
    .description("Get a completed job result.")
    .argument("<job_id>", "Job id.")
    .option("--agent", "Return an agent-safe redacted job result.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (jobId: string, options: AgentOutputOptions, command: Command) => {
        const normalizedJobId = requireString(jobId, "job_id");
        const endpoint = `/jobs/${encodeURIComponent(normalizedJobId)}/result`;
        const result = await createClient().get(endpoint);
        renderResult(result, {
          json: getMode(command).json,
          transform: jobOutput(result, options, "result"),
          human: jobHuman("Job result.", `/jobs/${normalizedJobId}/result`, result),
        });
      },
    );

  jobs
    .command("events")
    .description("List sanitized lifecycle events for one job.")
    .argument("<job_id>", "Job id.")
    .option("--limit <n>", "Maximum number of events.", "50")
    .option("--agent", "Return agent-safe redacted job events.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (
        jobId: string,
        options: { limit: string } & AgentOutputOptions,
        command: Command,
      ) => {
        const normalizedJobId = requireString(jobId, "job_id");
        const limit = optionalPositiveInteger(options.limit, "limit");
        const endpoint = `/jobs/${encodeURIComponent(normalizedJobId)}/events`;
        const result = await createClient().get(endpoint, { query: { limit } });
        renderResult(result, {
          json: getMode(command).json,
          transform: jobOutput(result, options, "events"),
          human: jobHuman("Job events.", `/jobs/${normalizedJobId}/events`, result, [
            ["Limit", limit],
          ]),
        });
      },
    );

  jobs
    .command("cancel")
    .description("Cancel a queued or processing job.")
    .argument("<job_id>", "Job id.")
    .option("--idempotency-key <key>", "Idempotency-Key request header.")
    .option(
      "--confirm-submit",
      "Confirm the user approved canceling this job.",
    )
    .option("--agent", "Return an agent-safe redacted cancellation result.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (
        jobId: string,
        options: AgentOutputOptions & {
          confirmSubmit?: boolean;
          idempotencyKey?: string;
        },
        command: Command,
      ) => {
        if (!options.confirmSubmit) {
          throw new CliError(
            "Canceling a job changes server state. Re-run with --confirm-submit after the user explicitly approves.",
            {
              code: "confirmation_required",
              hint: "Use --confirm-submit after confirming the job should be canceled.",
            },
          );
        }
        const normalizedJobId = requireString(jobId, "job_id");
        const endpoint = `/jobs/${encodeURIComponent(normalizedJobId)}/cancel`;
        const result = await createClient().post(endpoint, {}, {
          headers: { "Idempotency-Key": options.idempotencyKey },
        });
        renderResult(result, {
          json: getMode(command).json,
          transform: jobOutput(result, options, "cancel"),
          human: jobHuman("Job cancel.", `/jobs/${normalizedJobId}/cancel`, result),
        });
      },
    );

  jobs
    .command("watch")
    .description("Watch one or more jobs until terminal or timeout.")
    .argument("[job_id]", "Job id.")
    .option("--ids <ids>", "Comma-separated job ids to watch.")
    .option("--interval-seconds <n>", "Seconds between polls.", "5")
    .option("--timeout-seconds <n>", "Maximum watch duration in seconds.", "300")
    .option("--agent", "Return an agent-safe redacted watch aggregate.")
    .option("--redact-urls", "Redact URL and sensitive fields from JSON output.")
    .action(
      async (jobId: string | undefined, options: WatchOptions, command: Command) => {
        const jobIds = readWatchJobIds(jobId, options.ids);
        const intervalSeconds = optionalNonNegativeNumber(
          options.intervalSeconds,
          "interval-seconds",
        );
        const timeoutSeconds = optionalNonNegativeNumber(
          options.timeoutSeconds,
          "timeout-seconds",
        );
        const aggregate = await watchJobs(jobIds, {
          intervalSeconds,
          timeoutSeconds,
        });
        renderResult(aggregate, {
          json: getMode(command).json,
          transform: jobOutput(aggregate, options, "watch"),
          human: [
            ["Watched jobs", aggregate.watched_count],
            ["Terminal", aggregate.terminal],
            ["Status", aggregate.status],
          ],
        });
      },
    );

  jobs
    .command("download")
    .description("Download media artifacts from a completed job result into a local directory.")
    .argument("<job_id>", "Job id.")
    .requiredOption("--output-dir <dir>", "Directory to write downloaded media.")
    .option("--filename <name>", "Optional local filename for a single artifact.")
    .action(async (jobId: string, options: DownloadOptions, command: Command) => {
      const normalizedJobId = requireString(jobId, "job_id");
      const result = await createClient().get(
        `/jobs/${encodeURIComponent(normalizedJobId)}/result`,
      );
      const download = await downloadMediaFromValue(result, {
        outputDir: options.outputDir,
        filename: options.filename,
      });
      renderResult(download, {
        json: getMode(command).json,
        human: downloadHuman("Job media downloaded.", download),
      });
    });
}

function jobOutput(
  value: unknown,
  options: AgentOutputOptions,
  command: "cancel" | "events" | "get" | "list" | "result" | "status" | "watch",
) {
  if (options.agent) {
    const output = withAgentMetadata(value, {
      nextSteps: jobNextSteps(command),
    });
    return command === "list" || command === "watch"
      ? output
      : withAgentUsageSummary(output, value);
  }
  if (options.redactUrls) return redactForAgent(value).value;
  return value;
}

function withAgentUsageSummary(agentOutput: unknown, value: unknown) {
  if (!agentOutput || typeof agentOutput !== "object" || Array.isArray(agentOutput)) {
    return agentOutput;
  }
  const output = agentOutput as Record<string, unknown>;
  const agent = output.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return output;
  (agent as Record<string, unknown>).usage_summary = usageSummaryForAgent(value);
  return output;
}

function jobHuman(
  label: string,
  endpoint: string,
  value: unknown,
  extraFields: Array<[string, unknown]> = [],
) {
  const job = readJobHumanSummary(value);
  return [
    label,
    ["Endpoint", endpoint] as [string, unknown],
    job.id ? (["Job ID", job.id] as [string, unknown]) : null,
    job.type ? (["Type", job.type] as [string, unknown]) : null,
    job.status ? (["Status", job.status] as [string, unknown]) : null,
    job.nextAction ? (["Next action", job.nextAction] as [string, unknown]) : null,
    job.resultReady !== undefined
      ? (["Result ready", job.resultReady] as [string, unknown])
      : null,
    ...extraFields,
    ["Usage", formatUsageSummary(readUsageSummary(value))] as [string, unknown],
  ].filter((line): line is string | [string, unknown] => Boolean(line));
}

function readJobHumanSummary(value: unknown) {
  const root = record(value);
  const data = record(root.data);
  const job = record(data.job ?? root.job);
  return {
    id:
      readString(data, ["job_id", "request_id", "id"]) ??
      readString(job, ["id", "job_id", "request_id"]),
    type: readString(job, ["type"]),
    status:
      readString(data, ["sume_status", "status"]) ?? readString(job, ["status"]),
    nextAction: readString(data, ["next_action"]),
    resultReady:
      typeof data.result_ready === "boolean" ? data.result_ready : undefined,
  };
}

type UsageSummary =
  | {
      available: false;
      state: "unavailable";
      message: string;
    }
  | {
      available: true;
      billableMicros?: number;
      capturedMicros?: number;
      currency: string;
      estimatedMicros?: number;
      refundedMicros?: number;
      reservedMicros?: number;
      source: string;
      state: string;
    };

function readUsageSummary(value: unknown): UsageSummary {
  const candidate = findUsageRecord(value);
  if (!candidate) {
    return {
      available: false,
      state: "unavailable",
      message:
        "API response does not include final usage ledger fields for this job.",
    };
  }

  const usage = candidate.value;
  const state = readString(usage, ["status", "state", "usage_status"]) ?? "estimated";
  const currency =
    readString(usage, ["billable_currency", "currency"])?.toUpperCase() ?? "USD";
  const billableMicros = readUsdMicros(usage, [
    "billable_amount_usd_micros",
    "amount_usd_micros",
    "reserved_amount_usd_micros",
  ]);
  const estimatedMicros = readUsdMicros(usage, [
    "estimated_amount_usd_micros",
    "provider_estimated_cost_usd_micros",
    "estimated_usd_micros",
  ]);
  const reservedMicros =
    readUsdMicros(usage, ["reserved_amount_usd_micros"]) ??
    (state === "reserved" ? billableMicros : undefined);
  const capturedMicros =
    readUsdMicros(usage, ["captured_amount_usd_micros"]) ??
    (state === "captured" ? billableMicros : undefined);
  const refundedMicros =
    readUsdMicros(usage, [
      "refunded_amount_usd_micros",
      "released_amount_usd_micros",
    ]) ?? (state === "refunded" ? billableMicros : undefined);

  return {
    available: true,
    billableMicros,
    capturedMicros,
    currency,
    estimatedMicros,
    refundedMicros,
    reservedMicros,
    source: candidate.source,
    state,
  };
}

function findUsageRecord(value: unknown):
  | { source: string; value: Record<string, unknown> }
  | undefined {
  const root = record(value);
  const data = record(root.data);
  const directCandidates: Array<[string, unknown]> = [
    ["data.usage", data.usage],
    ["data.usage_summary", data.usage_summary],
    ["data.job.usage", record(data.job).usage],
    ["data.job.usage_summary", record(data.job).usage_summary],
    ["data.result.usage", record(data.result).usage],
    ["usage", root.usage],
    ["usage_summary", root.usage_summary],
  ];
  for (const [source, candidate] of directCandidates) {
    const usage = record(candidate);
    if (isUsageLike(usage)) return { source, value: usage };
  }

  const events = Array.isArray(data.events) ? data.events : [];
  for (const event of events) {
    const eventRecord = record(event);
    const eventData = record(eventRecord.data);
    for (const [source, candidate] of [
      ["event.data.usage", eventData.usage],
      ["event.data.usage_summary", eventData.usage_summary],
      ["event.data", eventData],
    ] as const) {
      const usage = record(candidate);
      if (isUsageLike(usage)) return { source, value: usage };
    }
  }
  return undefined;
}

function isUsageLike(value: Record<string, unknown>) {
  return [
    "amount_usd_cents",
    "amount_usd_micros",
    "billable_amount_usd_cents",
    "billable_amount_usd_micros",
    "captured_amount_usd_micros",
    "provider_estimated_cost_usd_micros",
    "refunded_amount_usd_micros",
    "reserved_amount_usd_micros",
    "usage_status",
  ].some((key) => key in value);
}

function readUsdMicros(
  value: Record<string, unknown>,
  microsKeys: string[],
): number | undefined {
  for (const key of microsKeys) {
    const micros = readNumber(value[key]);
    if (micros !== undefined) return micros;
  }
  for (const key of microsKeys) {
    const centsKey = key.replace(/_micros$/u, "_cents");
    const cents = readNumber(value[centsKey]);
    if (cents !== undefined) return cents * 10_000;
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

function formatUsageSummary(summary: UsageSummary) {
  if (!summary.available) return `unavailable - ${summary.message}`;
  const parts = [`state ${summary.state}`];
  if (summary.estimatedMicros !== undefined) {
    parts.push(`estimated ${formatUsd(summary.estimatedMicros, summary.currency)}`);
  }
  if (summary.billableMicros !== undefined) {
    parts.push(`billable ${formatUsd(summary.billableMicros, summary.currency)}`);
  }
  if (summary.reservedMicros !== undefined) {
    parts.push(`reserved ${formatUsd(summary.reservedMicros, summary.currency)}`);
  }
  if (summary.capturedMicros !== undefined) {
    parts.push(`captured ${formatUsd(summary.capturedMicros, summary.currency)}`);
  }
  if (summary.refundedMicros !== undefined) {
    parts.push(`refunded/released ${formatUsd(summary.refundedMicros, summary.currency)}`);
  }
  parts.push(`source ${summary.source}`);
  return parts.join("; ");
}

function usageSummaryForAgent(value: unknown) {
  const summary = readUsageSummary(value);
  if (!summary.available) return summary;
  return {
    available: true,
    billable_amount_usd_micros: summary.billableMicros,
    captured_amount_usd_micros: summary.capturedMicros,
    currency: summary.currency,
    estimated_amount_usd_micros: summary.estimatedMicros,
    refunded_or_released_amount_usd_micros: summary.refundedMicros,
    reserved_amount_usd_micros: summary.reservedMicros,
    source: summary.source,
    state: summary.state,
  };
}

function formatUsd(micros: number, currency: string) {
  const value = micros / 1_000_000;
  const precision = value > 0 && value < 0.01 ? 4 : 2;
  return `${currency} $${value.toFixed(precision)}`;
}

function readString(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jobNextSteps(
  command: "cancel" | "events" | "get" | "list" | "result" | "status" | "watch",
) {
  if (command === "list") {
    return [
      "Use sume jobs watch <job_id> --agent --json to poll one job.",
      "Use sume jobs watch --ids <job_id>,<job_id> --agent --json to poll multiple jobs.",
      "Use sume jobs result <job_id> --agent --json after a job completes.",
    ];
  }
  if (command === "watch") {
    return [
      "If terminal is false, rerun watch later or inspect individual job status.",
      "Use sume jobs result <job_id> --agent --json for completed jobs.",
    ];
  }
  if (command === "result") {
    return [
      "Use non-agent output only when the user explicitly needs raw result URLs.",
      "Use sume jobs download <job_id> --output-dir <dir> to save media without printing URLs.",
    ];
  }
  if (command === "events") {
    return [
      "Use events to inspect sanitized lifecycle, terminal, provider, and webhook delivery summaries.",
      "Use sume jobs status <job_id> --agent --json for the latest actionable polling state.",
    ];
  }
  if (command === "cancel") {
    return [
      "Use sume jobs status <job_id> --agent --json to confirm terminal cancellation state.",
      "Use sume jobs events <job_id> --agent --json for cancellation diagnostics.",
    ];
  }
  return [
    "Use sume jobs result <job_id> --agent --json after the job reaches a terminal completed state.",
  ];
}

function readWatchJobIds(jobId: string | undefined, ids: string | undefined) {
  const candidates = [
    ...(jobId ? [jobId] : []),
    ...(ids ? ids.split(",") : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const unique = [...new Set(candidates)];
  if (unique.length > 0) return unique;
  throw new CliError("job_id or --ids is required.", {
    code: "invalid_argument",
    hint: "Use sume jobs watch <job_id> --agent --json or sume jobs watch --ids job_1,job_2 --agent --json.",
  });
}

function optionalNonNegativeNumber(value: unknown, name: string) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError(`${name} must be a non-negative number.`, {
      code: "invalid_argument",
    });
  }
  return parsed;
}

async function watchJobs(
  jobIds: string[],
  options: { intervalSeconds?: number; timeoutSeconds?: number },
) {
  const client = createClient();
  const intervalMs = (options.intervalSeconds ?? 5) * 1000;
  const timeoutMs = (options.timeoutSeconds ?? 300) * 1000;
  const startedAt = Date.now();
  let pollCount = 0;
  let items: WatchItem[] = [];

  while (true) {
    pollCount += 1;
    items = [];
    for (const jobId of jobIds) {
      const endpoint = `/jobs/${encodeURIComponent(jobId)}/status`;
      const value = await client.get(endpoint);
      const status = readJobStatus(value);
      items.push({
        kind: "job_watch_item",
        job_id: jobId,
        status,
        terminal: isTerminalJobStatus(status),
        poll_count: pollCount,
        value,
      });
    }

    if (items.every((item) => item.terminal)) {
      return buildWatchAggregate(items, pollCount, "terminal");
    }

    if (timeoutMs === 0 || intervalMs === 0 || Date.now() - startedAt >= timeoutMs) {
      return buildWatchAggregate(items, pollCount, "timeout");
    }

    await sleep(Math.min(intervalMs, Math.max(0, timeoutMs - (Date.now() - startedAt))));
  }
}

type WatchItem = {
  job_id: string;
  kind: "job_watch_item";
  poll_count: number;
  status: string;
  terminal: boolean;
  value: unknown;
};

function buildWatchAggregate(
  items: WatchItem[],
  pollCount: number,
  status: "terminal" | "timeout",
) {
  const completedCount = items.filter((item) =>
    isCompletedJobStatus(item.status),
  ).length;
  const failedCount = items.filter((item) => isFailedJobStatus(item.status)).length;
  const terminal = items.every((item) => item.terminal);
  return {
    kind: "job_watch",
    status,
    terminal,
    watched_count: items.length,
    completed_count: completedCount,
    failed_count: failedCount,
    active_count: items.length - completedCount - failedCount,
    poll_count: pollCount,
    items,
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

function isTerminalJobStatus(status: string) {
  return isCompletedJobStatus(status) || isFailedJobStatus(status);
}

function isCompletedJobStatus(status: string) {
  return ["complete", "completed", "success", "succeeded"].includes(
    normalizeStatus(status),
  );
}

function isFailedJobStatus(status: string) {
  return ["canceled", "cancelled", "error", "errored", "failed"].includes(
    normalizeStatus(status),
  );
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
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

import { mcpTools } from "../mcp/tools.js";
import { AVATAR_MODEL_IDS } from "./models.js";
import {
  AVATAR_VIDEO_QUALITY_VALUES,
  DEFAULT_AVATAR_VIDEO_QUALITY,
} from "./quality.js";

export type ToolSafety = {
  mutating: boolean;
  paid_generation_call: boolean;
  read_only: boolean;
  requires_agent_redaction: boolean;
  requires_confirmation: boolean;
  returns_sensitive_url: boolean;
};

type GenerationExecution = "none" | "sume_api";
type GenerationRuntime = "none" | "sume_api";

export type JsonSchema = Record<string, unknown>;

export type ToolSchema = {
  object: "tool_schema";
  name: string;
  command: string;
  description: string;
  confirmation?: {
    accepted_flags: string[];
    mcp_session_gates: string[];
    required: boolean;
  };
  input_schema: JsonSchema;
  inputs: JsonSchema;
  mcp_input_schema: JsonSchema | null;
  examples: string[];
  next_steps: string[];
  safety: ToolSafety;
  execution: {
    cli_command: string;
    mcp_tool: string | null;
    generation_execution: GenerationExecution;
    generation_runtime: GenerationRuntime;
  };
  constraints?: string[];
};

type StaticToolDefinition = {
  command: string;
  confirmation?: ToolSchema["confirmation"];
  constraints?: string[];
  description?: string;
  examples?: string[];
  input_schema: JsonSchema;
  mcp_input_schema?: JsonSchema;
  next_steps?: string[];
  generation_execution?: GenerationExecution;
  generation_runtime?: GenerationRuntime;
};

const booleanProperty = { type: "boolean" };
const stringProperty = { type: "string" };
const agentOutputProperties = {
  agent: {
    ...booleanProperty,
    description: "Return an agent-safe response with URL and secret redaction.",
  },
  redact_urls: {
    ...booleanProperty,
    description: "Redact URL and sensitive fields without adding agent metadata.",
  },
};
const submitConfirmationProperties = {
  confirm_submit: {
    ...booleanProperty,
    description:
      "Required for write operations after explicit user approval to create or queue a job.",
  },
  confirm_paid: {
    ...booleanProperty,
    description:
      "Alias for --confirm-submit when paid generation is enabled.",
  },
};
const communicationProperties = {
  mode: {
    type: "string",
    enum: ["async", "sync", "subscribe", "webhook"],
    description:
      "Delivery mode. async returns immediately; sync and subscribe wait within wait_timeout_seconds; webhook records callback metadata.",
  },
  webhook_url: {
    ...stringProperty,
    description: "Public HTTPS callback URL, required when mode is webhook.",
  },
  wait_timeout_seconds: {
    type: "integer",
    minimum: 0,
    maximum: 30,
    description: "Sync wait budget in seconds.",
  },
  idempotency_key: {
    ...stringProperty,
    description: "Idempotency-Key request header for safe retries.",
  },
};
const submitConfirmation = {
  accepted_flags: ["confirm_submit", "confirm_paid"],
  mcp_session_gates: ["allowWrite", "allowPaid"],
  required: true,
};
const avatarModelProperties = {
  model: {
    ...stringProperty,
    enum: [AVATAR_MODEL_IDS.base],
    description: "Public Avatar model id.",
  },
};
const writeConfirmation = {
  accepted_flags: ["confirm_submit"],
  mcp_session_gates: ["allowWrite"],
  required: true,
};
const mcpSubmitProperties = {
  idempotency_key: {
    ...stringProperty,
    description: "Idempotency-Key request header for safe retries.",
  },
};
const mcpPaidGenerationProperties = {
  dry_run: {
    ...booleanProperty,
    description:
      "When true, returns a non-submitting Sume cost/readiness preview and does not create a job.",
  },
  idempotency_key: {
    ...stringProperty,
    description: "Required Idempotency-Key request header for safe retries.",
  },
  max_spend_usd: {
    type: "number",
    minimum: 0,
    description:
      "Maximum Sume USD spend allowed for this single paid generation call.",
  },
};
const mcpAvatarCommunicationProperties = {
  mode: {
    type: "string",
    enum: ["async", "sync", "subscribe", "webhook"],
    description: "Optional public delivery mode for the model run.",
  },
  webhook_url: {
    ...stringProperty,
    format: "uri",
    description: "Public HTTPS callback URL when mode is webhook.",
  },
  wait_timeout_seconds: {
    type: "integer",
    minimum: 0,
    maximum: 30,
    description: "Optional sync wait budget in seconds.",
  },
};
const mcpAvatarCreateBaseProperties = {
  ...mcpPaidGenerationProperties,
  model: {
    ...stringProperty,
    enum: [AVATAR_MODEL_IDS.base],
    description: "Optional public Avatar model id. Omit for Avatar 1.0.",
  },
  avatar_handle: {
    ...stringProperty,
    minLength: 1,
    description: "Desired canonical public avatar handle, without @.",
  },
  ...mcpAvatarCommunicationProperties,
};
const avatarProfileProperties = {
  ethnicity: {
    type: "string",
    enum: [
      "Asian",
      "South Asian",
      "Southeast Asian",
      "Black",
      "Hispanic",
      "Middle Eastern",
      "White",
      "Wasian",
    ],
    description: "Public Avatar profile ethnicity.",
  },
  sex: {
    type: "string",
    enum: ["male", "female"],
    description: "Public Avatar profile sex.",
  },
  age: {
    type: "integer",
    minimum: 20,
    maximum: 80,
    description: "Public Avatar profile age.",
  },
};
const assetPayloadProperties = {
  source_url: {
    ...stringProperty,
    format: "uri",
    maxLength: 2048,
    description:
      "Public HTTPS URL to register. Localhost, private-network, and non-HTTPS URLs are rejected by the API.",
  },
  media_type: {
    type: "string",
    enum: ["image", "video", "audio", "file"],
    description: "Optional media type hint. The API can infer a coarse type.",
  },
};
const assetListProperties = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 20,
    description: "Maximum number of assets to return.",
  },
  cursor: {
    ...stringProperty,
    description: "Opaque pagination cursor.",
  },
  media_type: assetPayloadProperties.media_type,
  status: {
    type: "string",
    enum: ["registered", "pending_upload", "ready", "mirrored", "failed", "archived"],
  },
};
const assetUploadUrlPayloadProperties = {
  content_type: {
    ...stringProperty,
    description: "MIME type to upload, for example image/png.",
  },
  size_bytes: {
    type: "integer",
    minimum: 1,
    description: "Declared byte size.",
  },
  media_type: assetPayloadProperties.media_type,
  filename: {
    ...stringProperty,
    maxLength: 255,
    description: "Optional original filename.",
  },
  checksum_sha256: {
    ...stringProperty,
    pattern: "^[a-fA-F0-9]{64}$",
    description: "Optional SHA-256 checksum hex.",
  },
};
const assetCompletePayloadProperties = {
  size_bytes: {
    type: "integer",
    minimum: 1,
    description: "Optional client-observed size.",
  },
  checksum_sha256: {
    ...stringProperty,
    pattern: "^[a-fA-F0-9]{64}$",
    description: "Optional client-observed SHA-256 checksum hex.",
  },
};
const staticToolDefinitions: Record<string, StaticToolDefinition> = {
  "account.me": {
    command: "sume account get --json",
    input_schema: objectSchema({}),
    examples: ["sume account get --json"],
    next_steps: [
      "Use sume doctor --agent --json when local auth or API readiness is unclear.",
    ],
  },
  "balance.get": {
    command: "sume balance --json",
    description: "Read available USD-denominated public API balance.",
    input_schema: objectSchema({}),
    examples: ["sume balance --json"],
    next_steps: [
      "Use sume usage get --json to inspect recent usage ledger entries when available.",
    ],
  },
  "usage.get": {
    command: "sume usage get --json",
    description: "Read recent public API usage ledger entries.",
    input_schema: objectSchema({
      limit: {
        type: "integer",
        minimum: 1,
        default: 20,
        description: "Maximum number of usage entries to return.",
      },
      cursor: {
        ...stringProperty,
        description: "Opaque pagination cursor.",
      },
    }),
    examples: ["sume usage get --limit 20 --json"],
    next_steps: [
      "Use sume balance --json for the current available balance snapshot.",
    ],
  },
  "skills.list": {
    command: "sume skills list --json",
    description: "List bundled Sume agent skill packs shipped with the CLI.",
    input_schema: objectSchema({
      query: {
        ...stringProperty,
        description: "Optional local search query.",
      },
    }),
    examples: ["sume skills list --json", "sume skills list avatar --json"],
    next_steps: [
      "Install relevant local skill packs with sume skills install <name>.",
      "Use sume skills export <name> to inspect bundled content without installing.",
    ],
  },
  "skills.install": {
    command: "sume skills install <name> --json",
    description: "Install a bundled Sume agent skill pack into local agent skill roots.",
    input_schema: objectSchema(
      {
        name: { ...stringProperty, minLength: 1 },
        force: {
          ...booleanProperty,
          description: "Overwrite an existing installed copy.",
        },
      },
      ["name"],
    ),
    examples: ["sume skills install sume --json"],
    next_steps: [
      "Run sume skills update <name> when the CLI bundle changes.",
      "Use sume skills remove <name> to remove local installed copies.",
    ],
  },
  "skills.update": {
    command: "sume skills update [name] --json",
    description: "Refresh one or all installed bundled Sume skill packs.",
    input_schema: objectSchema({
      name: {
        ...stringProperty,
        description: "Optional bundled skill name. Omit to update all installed bundled skills.",
      },
    }),
    examples: ["sume skills update --json", "sume skills update sume-avatar --json"],
    next_steps: ["Use sume skills list --json to see current bundled versions."],
  },
  "skills.remove": {
    command: "sume skills remove <name> --json",
    description: "Remove an installed bundled Sume skill pack from local skill roots.",
    input_schema: objectSchema(
      {
        name: { ...stringProperty, minLength: 1 },
      },
      ["name"],
    ),
    examples: ["sume skills remove sume --json"],
    next_steps: ["Use sume skills install <name> --json to reinstall later."],
  },
  "skills.export": {
    command: "sume skills export <name> --json",
    description: "Print bundled Sume agent skill pack files without installing them.",
    input_schema: objectSchema(
      {
        name: { ...stringProperty, minLength: 1 },
      },
      ["name"],
    ),
    examples: ["sume skills export sume-avatar-video --json"],
    next_steps: [
      "Use references from the exported skill pack for agent workflow setup.",
    ],
  },
  "tools.list": {
    command: "MCP tools.list",
    description: "List local Sume CLI and MCP tool contracts with safety metadata.",
    input_schema: objectSchema({}),
    examples: ["sume tools list --json"],
    next_steps: [
      "Use tools.schema from MCP or sume tools schema <name> --json to inspect one contract.",
    ],
  },
  "tools.schema": {
    command: "MCP tools.schema",
    description: "Read one local Sume CLI or MCP tool contract by name.",
    input_schema: objectSchema(
      {
        name: { ...stringProperty, minLength: 1 },
      },
      ["name"],
    ),
    examples: ["sume tools schema jobs.result --json"],
    next_steps: [
      "Use the returned mcp_input_schema for MCP payloads and input_schema for CLI flags.",
    ],
  },
  "catalog.list": {
    command: "sume catalog list --json",
    input_schema: objectSchema({}),
    examples: ["sume catalog list --json"],
    next_steps: [
      "Use sume tools list --json to map API capabilities to CLI commands.",
    ],
  },
  "health.service": {
    command: "sume health --json",
    description: "Check unversioned Sume API service health.",
    input_schema: objectSchema({}),
    examples: ["sume health --json"],
    next_steps: ["Use sume health v1 --json for the versioned API health check."],
  },
  "health.v1": {
    command: "sume health v1 --json",
    description: "Check versioned Sume API health.",
    input_schema: objectSchema({}),
    examples: ["sume health v1 --json"],
    next_steps: ["Use sume doctor --agent --json when local auth/config is unclear."],
  },
  "jobs.list": {
    command: "sume jobs list --agent --json",
    input_schema: objectSchema({
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 20,
        description: "Maximum number of jobs to return.",
      },
      ...agentOutputProperties,
    }),
    examples: ["sume jobs list --agent --json --limit 20"],
    next_steps: [
      "Use sume jobs watch --ids <job_id>,<job_id> --agent --json to monitor active jobs.",
      "Use sume jobs result <job_id> --agent --json after a job completes.",
    ],
  },
  "jobs.get": {
    command: "sume jobs get <job_id> --agent --json",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["job_id"],
    ),
    examples: ["sume jobs get job_123 --agent --json"],
    next_steps: [
      "Use sume jobs status <job_id> --agent --json for a queue-friendly status snapshot.",
    ],
  },
  "jobs.status": {
    command: "sume jobs status <job_id> --agent --json",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["job_id"],
    ),
    examples: ["sume jobs status job_123 --agent --json"],
    next_steps: [
      "Use sume jobs watch <job_id> --agent --json for repeated polling with a terminal aggregate.",
      "Use sume jobs result <job_id> --agent --json after completion.",
    ],
  },
  "jobs.watch": {
    command: "sume jobs watch <job_id> --agent --json",
    description:
      "Poll one or more jobs and return an aggregate terminal/timeout status for agents.",
    input_schema: objectSchema({
      job_id: {
        ...stringProperty,
        minLength: 1,
        description: "Single job id. Use ids for multiple jobs.",
      },
      ids: {
        type: "array",
        items: { ...stringProperty, minLength: 1 },
        description: "Multiple job ids to watch.",
      },
      interval_seconds: {
        type: "number",
        minimum: 0,
        default: 5,
        description: "Seconds between polls.",
      },
      timeout_seconds: {
        type: "number",
        minimum: 0,
        default: 300,
        description: "Maximum watch duration in seconds.",
      },
      ...agentOutputProperties,
    }),
    examples: [
      "sume jobs watch job_123 --agent --json",
      "sume jobs watch --ids job_123,job_456 --agent --json",
    ],
    next_steps: [
      "If terminal is false, rerun watch later or inspect individual job statuses.",
      "After completed jobs are terminal, call sume jobs result <job_id> --agent --json.",
    ],
    constraints: ["Provide either job_id or ids."],
  },
  "jobs.wait": {
    command: "MCP jobs.wait",
    description:
      "Poll one job status until it reaches a terminal state or the bounded timeout expires.",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        interval_seconds: {
          type: "number",
          minimum: 1,
          maximum: 60,
          default: 5,
          description: "Seconds between status polls.",
        },
        timeout_seconds: {
          type: "number",
          minimum: 0,
          maximum: 600,
          default: 300,
          description: "Maximum wait duration in seconds.",
        },
      },
      ["job_id"],
    ),
    examples: ["MCP jobs.wait { job_id: 'job_123', timeout_seconds: 300 }"],
    next_steps: [
      "If terminal is false, call jobs.wait again later or inspect jobs.events.",
      "After completion, call jobs.result for the sanitized result summary.",
    ],
  },
  "jobs.result": {
    command: "sume jobs result <job_id> --agent --json",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["job_id"],
    ),
    examples: ["sume jobs result job_123 --agent --json"],
    next_steps: [
      "Use non-agent output only when the user explicitly needs raw result URLs.",
      "Do not echo raw signed or private media URLs in final agent reports.",
    ],
  },
  "jobs.download": {
    command: "sume jobs download <job_id> --output-dir <dir> --json",
    description:
      "Download media artifacts from a completed job result into an explicit local directory without printing remote URLs.",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        output_dir: {
          ...stringProperty,
          minLength: 1,
          description: "Explicit local directory to write downloaded media files.",
        },
        filename: {
          ...stringProperty,
          description: "Optional local filename for a single artifact.",
        },
      },
      ["job_id", "output_dir"],
    ),
    examples: ["sume jobs download job_123 --output-dir ./sume-downloads --json"],
    next_steps: [
      "Report local file paths and byte counts only.",
      "Use sume jobs result <job_id> --agent --json for metadata readback without downloads.",
    ],
    constraints: [
      "Downloads only HTTPS media URLs found in public API job result payloads.",
      "Remote URLs are consumed internally and omitted from CLI output.",
    ],
  },
  "jobs.events": {
    command: "sume jobs events <job_id> --agent --json",
    description: "List sanitized lifecycle, provider, terminal, and webhook events.",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
        },
        ...agentOutputProperties,
      },
      ["job_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
        },
      },
      ["job_id"],
    ),
    examples: ["sume jobs events job_123 --agent --json --limit 50"],
    next_steps: [
      "Use sume jobs status <job_id> --agent --json for the latest actionable state.",
      "Do not expect provider task ids or raw provider URLs in public-safe events.",
    ],
  },
  "jobs.cancel": {
    command: "sume jobs cancel <job_id> --confirm-submit --agent --json",
    description: "Cancel a queued or processing job.",
    confirmation: writeConfirmation,
    input_schema: writeCliSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        idempotency_key: communicationProperties.idempotency_key,
        confirm_submit: submitConfirmationProperties.confirm_submit,
        ...agentOutputProperties,
      },
      ["job_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        idempotency_key: communicationProperties.idempotency_key,
      },
      ["job_id"],
    ),
    examples: ["sume jobs cancel job_123 --confirm-submit --agent --json"],
    next_steps: [
      "Use sume jobs status <job_id> --agent --json to confirm terminal cancellation.",
      "Use sume jobs events <job_id> --agent --json for cancellation diagnostics.",
    ],
  },
  "assets.list": {
    command: "sume assets list --agent --json",
    description:
      "List advanced compatibility workspace-scoped input assets. Hidden from the launch OpenAPI/catalog.",
    input_schema: objectSchema({
      ...assetListProperties,
      ...agentOutputProperties,
    }),
    mcp_input_schema: objectSchema(assetListProperties),
    examples: ["sume assets list --agent --json --limit 20 --media-type image"],
    next_steps: [
      "Use sume assets get <asset_id> --agent --json for one asset.",
      "Do not echo raw asset URLs in final agent reports.",
    ],
  },
  "assets.get": {
    command: "sume assets get <asset_id> --agent --json",
    description:
      "Get one advanced compatibility workspace-scoped input asset. Public responses omit registered source URLs.",
    input_schema: objectSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["asset_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
      },
      ["asset_id"],
    ),
    examples: ["sume assets get asset_123 --agent --json"],
    next_steps: [
      "Use asset metadata as context for current image/video generation requests only when the user explicitly asks.",
      "Do not echo raw asset URLs in final agent reports.",
      "Use sume assets list --agent --json when you need to browse known assets.",
    ],
  },
  "assets.upload_url": {
    command:
      "sume assets upload-url --confirm-submit --content-type image/png --size-bytes <bytes> --agent --json",
    description:
      "Create a short-lived signed direct-upload URL through the advanced compatibility asset workflow. This is a write operation but not a paid generation call.",
    confirmation: writeConfirmation,
    input_schema: writeCliSchema(
      {
        payload_json: {
          ...stringProperty,
          description: "Exact API request body as JSON. Mutually exclusive with payload_file.",
        },
        payload_file: {
          ...stringProperty,
          description:
            "Path to an exact API request body JSON file. Mutually exclusive with payload_json.",
        },
        ...assetUploadUrlPayloadProperties,
        idempotency_key: communicationProperties.idempotency_key,
        confirm_submit: submitConfirmationProperties.confirm_submit,
        ...agentOutputProperties,
      },
      ["content_type", "size_bytes"],
    ),
    mcp_input_schema: mcpSubmitSchema(
      objectSchema(assetUploadUrlPayloadProperties, ["content_type", "size_bytes"]),
      "Exact /v1/assets/upload-url API request body.",
    ),
    examples: [
      "sume assets upload-url --confirm-submit --content-type image/png --size-bytes 12345 --agent --json",
    ],
    next_steps: [
      "Do not log or echo the signed upload URL.",
      "After uploading bytes outside the CLI, run sume assets complete <asset_id> --confirm-submit --agent --json.",
    ],
  },
  "assets.upload_file": {
    command: "MCP assets.upload_file",
    description:
      "Upload one local file through the advanced compatibility asset workflow by creating a signed upload URL, PUTing bytes internally, and completing the asset without returning the signed URL.",
    confirmation: writeConfirmation,
    input_schema: objectSchema(
      {
        path: {
          ...stringProperty,
          minLength: 1,
          description: "Local file path supplied by the MCP host/user.",
        },
        content_type: assetUploadUrlPayloadProperties.content_type,
        filename: assetUploadUrlPayloadProperties.filename,
        media_type: assetUploadUrlPayloadProperties.media_type,
        checksum_sha256: assetUploadUrlPayloadProperties.checksum_sha256,
        idempotency_key: communicationProperties.idempotency_key,
      },
      ["path", "content_type"],
    ),
    examples: [
      "MCP assets.upload_file { path: './reference.png', content_type: 'image/png', media_type: 'image' }",
    ],
    next_steps: [
      "The signed upload URL is used internally and redacted from MCP output.",
      "Use assets.get to confirm the asset status later.",
    ],
    constraints: [
      "Available only when the MCP server is started with --allow-write.",
      "Hidden from the default launch MCP server; select --toolsets assets explicitly.",
      "MCP local file uploads are limited to 512 MiB.",
    ],
  },
  "assets.complete": {
    command: "sume assets complete <asset_id> --confirm-submit --agent --json",
    description:
      "Mark a direct-uploaded advanced compatibility input asset as complete.",
    confirmation: writeConfirmation,
    input_schema: writeCliSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
        payload_json: {
          ...stringProperty,
          description: "Exact API request body as JSON. Mutually exclusive with payload_file.",
        },
        payload_file: {
          ...stringProperty,
          description:
            "Path to an exact API request body JSON file. Mutually exclusive with payload_json.",
        },
        ...assetCompletePayloadProperties,
        idempotency_key: communicationProperties.idempotency_key,
        confirm_submit: submitConfirmationProperties.confirm_submit,
        ...agentOutputProperties,
      },
      ["asset_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
        idempotency_key: communicationProperties.idempotency_key,
        payload: objectSchema(assetCompletePayloadProperties),
      },
      ["asset_id"],
    ),
    examples: ["sume assets complete asset_123 --confirm-submit --agent --json"],
    next_steps: ["Use sume assets get <asset_id> --agent --json to confirm readiness."],
  },
  "assets.download_url": {
    command: "sume assets download-url <asset_id> --agent --json",
    description:
      "Create a short-lived signed download URL for a ready advanced compatibility first-party uploaded asset.",
    input_schema: objectSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["asset_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
      },
      ["asset_id"],
    ),
    examples: ["sume assets download-url asset_123 --agent --json"],
    next_steps: [
      "Do not echo signed download URLs in final agent reports.",
      "Use non-agent output only when the user explicitly asks for the short-lived URL.",
    ],
  },
  "assets.download": {
    command: "sume assets download <asset_id> --output-dir <dir> --json",
    description:
      "Create and consume a short-lived advanced compatibility asset download URL, saving the media locally without printing the signed URL.",
    input_schema: objectSchema(
      {
        asset_id: { ...stringProperty, minLength: 1 },
        output_dir: {
          ...stringProperty,
          minLength: 1,
          description: "Explicit local directory to write the downloaded asset.",
        },
        filename: {
          ...stringProperty,
          description: "Optional local filename.",
        },
      },
      ["asset_id", "output_dir"],
    ),
    examples: ["sume assets download asset_123 --output-dir ./sume-downloads --json"],
    next_steps: [
      "Report local file paths and byte counts only.",
      "Use sume assets get <asset_id> --agent --json for public-safe metadata.",
    ],
    constraints: [
      "Signed download URLs are consumed internally and omitted from CLI output.",
      "The asset must be ready and downloadable by the public API.",
    ],
  },
  "assets.create": {
    command: "sume assets create --confirm-submit --source-url <PUBLIC_HTTPS_URL> --agent --json",
    description:
      "Register a public HTTPS URL as an advanced compatibility workspace-scoped input asset. This is a write operation but not a paid generation call.",
    confirmation: writeConfirmation,
    input_schema: writeCliSchema(
      {
        payload_json: {
          ...stringProperty,
          description: "Exact API request body as JSON. Mutually exclusive with payload_file.",
        },
        payload_file: {
          ...stringProperty,
          description:
            "Path to an exact API request body JSON file. Mutually exclusive with payload_json.",
        },
        source_url: assetPayloadProperties.source_url,
        media_type: assetPayloadProperties.media_type,
        idempotency_key: communicationProperties.idempotency_key,
        agent: {
          ...booleanProperty,
          description: "Return an agent-safe response with URL redaction and next steps.",
        },
        redact_urls: agentOutputProperties.redact_urls,
        confirm_submit: submitConfirmationProperties.confirm_submit,
      },
      ["source_url"],
    ),
    mcp_input_schema: mcpSubmitSchema(
      objectSchema(assetPayloadProperties, ["source_url"]),
      "Exact /v1/assets API request body.",
    ),
    examples: [
      "sume assets create --confirm-submit --source-url https://example.com/reference.png --media-type image --agent --json",
      "sume assets get asset_123 --agent --json",
    ],
    next_steps: [
      "Ask for explicit user approval before passing --confirm-submit.",
      "Capture data.asset.id from the response.",
      "Use sume assets get <asset_id> --agent --json to refresh asset metadata.",
    ],
    constraints: [
      "payload_json and payload_file are exact-body escape hatches and are mutually exclusive.",
      "The public API omits the registered source URL from responses.",
      "This endpoint registers URL metadata only; it is not a binary upload or provider generation call.",
      "Hidden from the launch OpenAPI/catalog; use URL fields directly for normal generation.",
    ],
  },
  "avatars.list": {
    command: "sume avatars list --status ready --limit 10 --agent --json",
    description: "List Sume avatar resources.",
    input_schema: objectSchema({
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 20,
        description: "Maximum number of avatars to return.",
      },
      ready: {
        ...booleanProperty,
        description: "Shortcut for status=ready.",
      },
      status: {
        type: "string",
        enum: ["ready", "queued", "processing", "completed", "failed", "canceled"],
        description:
          "Filter by resource-friendly ready status or underlying job lifecycle status.",
      },
      handle: {
        ...stringProperty,
        description: "Filter by avatar handle, with or without @.",
      },
      ...agentOutputProperties,
    }),
    mcp_input_schema: objectSchema({
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 20,
      },
      status: {
        type: "string",
        enum: ["ready", "queued", "processing", "completed", "failed", "canceled"],
      },
      handle: {
        ...stringProperty,
        description: "Filter by avatar handle, with or without @.",
      },
    }),
    examples: [
      "sume avatars list --status ready --limit 10 --agent --json",
      "sume avatars list --handle @studio_presenter --agent --json",
      "sume avatars list --ready",
    ],
    next_steps: [
      "Use sume avatars get <avatar_id> --agent --json for details.",
      "Use ready avatar handles with sume avatar-videos create --confirm-paid.",
    ],
  },
  "avatars.get": {
    command: "sume avatars get <avatar_id> --agent --json",
    description: "Get one Sume avatar resource.",
    input_schema: objectSchema(
      {
        avatar_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["avatar_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        avatar_id: { ...stringProperty, minLength: 1 },
      },
      ["avatar_id"],
    ),
    examples: ["sume avatars get avatar_123 --agent --json"],
    next_steps: [
      "Use ready avatar handles with sume avatar-videos create --confirm-paid.",
      "Use sume jobs status <job_id> --agent --json when the response includes a job id.",
    ],
  },
  "avatars.wait": {
    command: "MCP avatars.wait",
    description:
      "Poll one avatar generation job and return an avatar-focused result summary when terminal.",
    input_schema: objectSchema(
      {
        job_id: { ...stringProperty, minLength: 1 },
        interval_seconds: {
          type: "number",
          minimum: 1,
          maximum: 60,
          default: 5,
          description: "Seconds between status polls.",
        },
        timeout_seconds: {
          type: "number",
          minimum: 0,
          maximum: 600,
          default: 300,
          description: "Maximum wait duration in seconds.",
        },
      },
      ["job_id"],
    ),
    examples: ["MCP avatars.wait { job_id: 'job_123', timeout_seconds: 300 }"],
    next_steps: [
      "Use avatar_summary.avatar_id with avatars.get when present.",
      "Use avatar_summary.artifacts for public generated media URLs.",
      "If terminal is false, call avatars.wait again later or inspect jobs.events.",
    ],
  },
  "avatars.create": {
    command: "sume avatars create --confirm-submit --json ...",
    description:
      "Submit an Avatar 1.0 model run through the public Sume Avatar model-run API.",
    confirmation: submitConfirmation,
    input_schema: submitCliSchema(
      {
        payload_json: {
          ...stringProperty,
          description: "Exact API request body as JSON. Mutually exclusive with payload_file.",
        },
        payload_file: {
          ...stringProperty,
          description:
            "Path to an exact API request body JSON file. Mutually exclusive with payload_json.",
        },
        ...avatarModelProperties,
        type: {
          type: "string",
          enum: ["prompt", "photo", "props"],
          default: "prompt",
          description: "Avatar request type.",
        },
        avatar_handle: {
          ...stringProperty,
          description: "Desired canonical public avatar handle, without @.",
        },
        handle: {
          ...stringProperty,
          description: "Alias for avatar_handle.",
        },
        prompt: {
          ...stringProperty,
          description: "Prompt text required when type is prompt.",
        },
        image_url: {
          ...stringProperty,
          description: "Public source image URL required when type is photo.",
        },
        ethnicity: {
          type: "string",
          enum: [
            "Asian",
            "South Asian",
            "Southeast Asian",
            "Black",
            "Hispanic",
            "Middle Eastern",
            "White",
            "Wasian",
          ],
          description: "Ethnicity required when type is props.",
        },
        sex: {
          type: "string",
          enum: ["male", "female"],
          description: "Sex required when type is props.",
        },
        age: {
          type: "integer",
          minimum: 20,
          maximum: 80,
          description: "Age required when type is props.",
        },
        ...communicationProperties,
        ...submitConfirmationProperties,
      },
    ),
    mcp_input_schema: objectSchema(
      {
        ...mcpPaidGenerationProperties,
        model: {
          ...stringProperty,
          enum: [AVATAR_MODEL_IDS.base],
          description:
            "Optional public Avatar model id. Omit for Avatar 1.0.",
        },
        payload: {
          ...passthroughObjectSchema({}, []),
          description:
            "Exact Avatar model-run API request body for the selected public model.",
        },
      },
      ["idempotency_key", "max_spend_usd", "payload"],
    ),
    examples: [
      "sume avatars create --confirm-submit --avatar-handle presenter --prompt 'A friendly presenter' --json",
      "sume avatars create --confirm-submit --type photo --avatar-handle photo_presenter --image-url <SOURCE_IMAGE_URL> --json",
      "sume avatars create --confirm-submit --payload-json '{\"avatar_handle\":\"presenter\",\"input\":{\"type\":\"prompt\",\"prompt\":\"A friendly presenter\"}}' --json",
    ],
    next_steps: [
      "Ask for explicit user approval before passing --confirm-submit or --confirm-paid.",
      "Use returned request_id with sume jobs watch <job_id> --agent --json.",
    ],
    constraints: [
      "payload_json and payload_file are exact-body escape hatches and are mutually exclusive.",
      `model defaults to ${AVATAR_MODEL_IDS.base}.`,
      "Flag-built requests submit avatar_handle plus an input union.",
      "type prompt requires avatar_handle plus prompt.",
      "type photo requires avatar_handle plus image_url.",
      "type props requires avatar_handle plus ethnicity, sex, and age.",
      "mode webhook requires webhook_url.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatars.create_prompt": {
    command: "MCP avatars.create_prompt",
    description:
      "Create an Avatar 1.0 avatar from a text prompt without requiring the raw API payload shape.",
    confirmation: submitConfirmation,
    input_schema: objectSchema(
      {
        ...mcpAvatarCreateBaseProperties,
        prompt: {
          ...stringProperty,
          minLength: 1,
          description: "Prompt text that describes the avatar.",
        },
      },
      ["idempotency_key", "max_spend_usd", "avatar_handle", "prompt"],
    ),
    examples: [
      "MCP avatars.create_prompt { avatar_handle: 'presenter', prompt: 'A friendly studio presenter', idempotency_key: 'avatar-1', max_spend_usd: 6 }",
    ],
    next_steps: [
      "Use avatar_summary.job_id with avatars.wait to poll and read grouped artifacts.",
      "Use avatar_summary.avatar_id with avatars.get when present.",
      "Do not echo signed or private media URLs in agent reports.",
    ],
    constraints: [
      "Runs through an internal Sume cost/readiness preview before submit.",
      "Requires MCP --allow-write --allow-paid gates and per-call max_spend_usd.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatars.create_props": {
    command: "MCP avatars.create_props",
    description:
      "Create an Avatar 1.0 avatar from structured profile properties without requiring the raw API payload shape.",
    confirmation: submitConfirmation,
    input_schema: objectSchema(
      {
        ...mcpAvatarCreateBaseProperties,
        ...avatarProfileProperties,
      },
      [
        "idempotency_key",
        "max_spend_usd",
        "avatar_handle",
        "ethnicity",
        "sex",
        "age",
      ],
    ),
    examples: [
      "MCP avatars.create_props { avatar_handle: 'profile_presenter', ethnicity: 'Asian', sex: 'female', age: 32, idempotency_key: 'avatar-2', max_spend_usd: 6 }",
    ],
    next_steps: [
      "Use avatar_summary.job_id with avatars.wait to poll and read grouped artifacts.",
      "Use avatar_summary.avatar_id with avatars.get when present.",
      "Do not echo signed or private media URLs in agent reports.",
    ],
    constraints: [
      "Runs through an internal Sume cost/readiness preview before submit.",
      "Requires MCP --allow-write --allow-paid gates and per-call max_spend_usd.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatars.create_photo_url": {
    command: "MCP avatars.create_photo_url",
    description:
      "Create an Avatar 1.0 avatar from a public image URL.",
    confirmation: submitConfirmation,
    input_schema: objectSchema(
      {
        ...mcpAvatarCreateBaseProperties,
        image_url: {
          ...stringProperty,
          minLength: 1,
          format: "uri",
          description: "Public HTTPS source image URL.",
        },
      },
      ["idempotency_key", "max_spend_usd", "avatar_handle", "image_url"],
    ),
    examples: [
      "MCP avatars.create_photo_url { avatar_handle: 'photo_presenter', image_url: 'https://example.com/reference.png', idempotency_key: 'avatar-3', max_spend_usd: 6 }",
    ],
    next_steps: [
      "Use avatar_summary.job_id with avatars.wait to poll and read grouped artifacts.",
      "Use avatar_summary.avatar_id with avatars.get when present.",
      "Do not echo signed or private media URLs in agent reports.",
    ],
    constraints: [
      "Runs through an internal Sume cost/readiness preview before submit.",
      "Local file upload is deferred until the public URL-first upload helper is available.",
      "Requires MCP --allow-write --allow-paid gates and per-call max_spend_usd.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatars.batch.plan": {
    command: "sume avatars batch plan <manifest_file> --json",
    description:
      "Validate a local avatar batch manifest and emit per-item API payloads without API or live generation calls.",
    input_schema: objectSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        output_file: {
          ...stringProperty,
          description: "Optional path to write the generated plan JSON.",
        },
      },
      ["manifest_file"],
    ),
    examples: ["sume avatars batch plan ./avatars.batch.json --json"],
    next_steps: [
      "Fix item errors before submitting.",
      "Submit only after explicit paid approval with sume avatars batch create --confirm-paid.",
    ],
  },
  "avatars.batch.create": {
    command: "sume avatars batch create <manifest_file> --confirm-paid --json",
    description:
      "Submit ready avatar batch items with per-item idempotency keys and write a local state file.",
    confirmation: submitConfirmation,
    input_schema: submitCliSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        state_file: {
          ...stringProperty,
          description: "Local state file path. Defaults to <manifest_file>.state.json.",
        },
        idempotency_key_prefix: {
          ...stringProperty,
          description: "Stable prefix for per-item Idempotency-Key values.",
        },
        confirm_submit: submitConfirmationProperties.confirm_submit,
        confirm_paid: submitConfirmationProperties.confirm_paid,
      },
      ["manifest_file"],
    ),
    examples: [
      "sume avatars batch create ./avatars.batch.json --state-file ./avatars.state.json --confirm-paid --json",
    ],
    next_steps: [
      "Use sume avatars batch watch <manifest_file> --state-file <state> --json to poll jobs.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatars.batch.watch": {
    command: "sume avatars batch watch <manifest_file> --state-file <state> --json",
    description: "Poll jobs from a local avatar batch state file.",
    input_schema: objectSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        state_file: {
          ...stringProperty,
          description: "Local state file path. Defaults to <manifest_file>.state.json.",
        },
        interval_seconds: { type: "number", minimum: 0, default: 5 },
        timeout_seconds: { type: "number", minimum: 0, default: 300 },
      },
      ["manifest_file"],
    ),
    examples: [
      "sume avatars batch watch ./avatars.batch.json --state-file ./avatars.state.json --timeout-seconds 0 --json",
    ],
    next_steps: [
      "Use sume avatars batch result <manifest_file> --state-file <state> --json after completion.",
    ],
  },
  "avatars.batch.result": {
    command: "sume avatars batch result <manifest_file> --state-file <state> --json",
    description: "Fetch redacted job results for a local avatar batch state file.",
    input_schema: objectSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        state_file: {
          ...stringProperty,
          description: "Local state file path. Defaults to <manifest_file>.state.json.",
        },
      },
      ["manifest_file"],
    ),
    examples: [
      "sume avatars batch result ./avatars.batch.json --state-file ./avatars.state.json --json",
    ],
    next_steps: [
      "Use sume avatars list --ready --agent --json to inspect generated ready avatars.",
    ],
  },
  "avatar-videos.list": {
    command: "sume avatar-videos list --agent --json",
    description: "List Sume avatar video resources.",
    input_schema: objectSchema(agentOutputProperties),
    mcp_input_schema: objectSchema({}),
    examples: ["sume avatar-videos list --agent --json"],
    next_steps: [
      "Use sume avatar-videos get <avatar_video_id> --agent --json for details.",
      "Use sume jobs result <job_id> --agent --json when a completed job id is available.",
    ],
  },
  "avatar-videos.get": {
    command: "sume avatar-videos get <avatar_video_id> --agent --json",
    description: "Get one Sume avatar video resource.",
    input_schema: objectSchema(
      {
        avatar_video_id: { ...stringProperty, minLength: 1 },
        ...agentOutputProperties,
      },
      ["avatar_video_id"],
    ),
    mcp_input_schema: objectSchema(
      {
        avatar_video_id: { ...stringProperty, minLength: 1 },
      },
      ["avatar_video_id"],
    ),
    examples: ["sume avatar-videos get avatar_video_123 --agent --json"],
    next_steps: [
      "Use media.sume.com result URLs only when the user asks for the generated media link.",
      "Use sume jobs events <job_id> --agent --json for sanitized diagnostics when available.",
    ],
  },
  "avatar-videos.create": {
    command: "sume avatar-videos create --confirm-submit --json ...",
    description:
      "Submit an Avatar Video 1.0 model run through /v1/models/sume/avatar-video/v1.0/runs.",
    confirmation: submitConfirmation,
    input_schema: submitCliSchema(
      {
        payload_json: {
          ...stringProperty,
          description: "Exact API request body as JSON. Mutually exclusive with payload_file.",
        },
        payload_file: {
          ...stringProperty,
          description:
            "Path to an exact API request body JSON file. Mutually exclusive with payload_json.",
        },
        script: {
          ...stringProperty,
          description: "Video script, estimated at 4-60 seconds.",
        },
        product_image: {
          ...stringProperty,
          description: "Optional product/reference image URL for the public API request.",
        },
        avatar_handle: {
          ...stringProperty,
          description: "Ready avatar handle to use in the video.",
        },
        scene_prompt: {
          ...stringProperty,
          description: "Prompt scene description. Mutually exclusive with scene_image_url.",
        },
        scene_image_url: {
          ...stringProperty,
          description: "Photo scene image URL. Mutually exclusive with scene_prompt.",
        },
        quality: {
          ...stringProperty,
          enum: AVATAR_VIDEO_QUALITY_VALUES,
          description: `Avatar Video quality selector. Defaults to ${DEFAULT_AVATAR_VIDEO_QUALITY}.`,
        },
        resolution: {
          type: "string",
          enum: ["720p"],
          description: "Current API accepts 720p.",
        },
        aspect_ratio: { ...stringProperty, description: "Optional aspect ratio." },
        title: { ...stringProperty, description: "Optional title." },
        ...communicationProperties,
        ...submitConfirmationProperties,
      },
      ["script", "avatar_handle"],
    ),
    mcp_input_schema: {
      ...objectSchema(
        {
          ...mcpPaidGenerationProperties,
          script: {
            ...stringProperty,
            description: "Video script, estimated at 4-60 seconds.",
          },
          product_image: {
            ...stringProperty,
            description:
              "Optional public HTTPS product/reference image URL.",
          },
          avatar_handle: {
            ...stringProperty,
            description: "Ready avatar handle, with or without @.",
          },
          scene_prompt: {
            ...stringProperty,
            description:
              "Prompt scene description. Mutually exclusive with scene_image_url. Normalizes to scene: { type: 'prompt', prompt }.",
          },
          scene_image_url: {
            ...stringProperty,
            description:
              "Photo scene image URL. Mutually exclusive with scene_prompt. Normalizes to scene: { type: 'photo', image_url }.",
          },
          quality: {
            ...stringProperty,
            enum: AVATAR_VIDEO_QUALITY_VALUES,
            description: `Avatar Video quality selector. Defaults to ${DEFAULT_AVATAR_VIDEO_QUALITY}.`,
          },
          resolution: {
            type: "string",
            enum: ["720p"],
            description: "Current API accepts 720p.",
          },
          aspect_ratio: { ...stringProperty, description: "Optional aspect ratio." },
          title: { ...stringProperty, description: "Optional title." },
          ...communicationProperties,
          payload: {
            ...passthroughObjectSchema({}, []),
            description:
              "Advanced exact /v1/models/sume/avatar-video/v1.0/runs request body. Prefer top-level friendly fields for agent use.",
          },
        },
        ["idempotency_key", "max_spend_usd"],
      ),
      anyOf: [
        { required: ["payload"] },
        { required: ["avatar_handle", "script"] },
      ],
    },
    examples: [
      "sume avatar-videos create --confirm-submit --script 'Say hello.' --avatar-handle studio_presenter --scene-prompt 'Clean studio' --json",
      "sume avatar-videos create --confirm-submit --script 'Say hello.' --avatar-handle studio_presenter --quality standard --aspect-ratio 9:16 --json",
    ],
    next_steps: [
      "Ask for explicit user approval before passing --confirm-submit or --confirm-paid.",
      "Use returned request_id with sume jobs watch <job_id> --agent --json.",
    ],
    constraints: [
      "payload_json and payload_file are exact-body escape hatches and are mutually exclusive.",
      "avatar_handle is required for flag-built requests.",
      "scene_prompt and scene_image_url are mutually exclusive.",
      "For MCP, use either exact payload or top-level friendly fields, not both.",
      `quality defaults to ${DEFAULT_AVATAR_VIDEO_QUALITY} and can be set to standard, plus, or max.`,
      "script must estimate to 4-60 seconds.",
      "mode webhook requires webhook_url.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatar-videos.batch.plan": {
    command: "sume avatar-videos batch plan <manifest_file> --json",
    description:
      "Validate a local avatar-video batch manifest without API or live generation calls.",
    input_schema: objectSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        output_file: {
          ...stringProperty,
          description: "Optional path to write the generated plan JSON.",
        },
      },
      ["manifest_file"],
    ),
    examples: ["sume avatar-videos batch plan ./videos.batch.json --json"],
    next_steps: [
      "Fix item errors before submitting.",
      "Submit only after explicit paid approval with sume avatar-videos batch create --confirm-paid.",
    ],
  },
  "avatar-videos.batch.create": {
    command: "sume avatar-videos batch create <manifest_file> --confirm-paid --json",
    description:
      "Submit ready avatar-video batch items with per-item idempotency keys and write a local state file.",
    confirmation: submitConfirmation,
    input_schema: submitCliSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        state_file: {
          ...stringProperty,
          description: "Local state file path. Defaults to <manifest_file>.state.json.",
        },
        idempotency_key_prefix: {
          ...stringProperty,
          description: "Stable prefix for per-item Idempotency-Key values.",
        },
        confirm_submit: submitConfirmationProperties.confirm_submit,
        confirm_paid: submitConfirmationProperties.confirm_paid,
      },
      ["manifest_file"],
    ),
    examples: [
      "sume avatar-videos batch create ./videos.batch.json --state-file ./videos.state.json --confirm-paid --json",
    ],
    next_steps: [
      "Use sume avatar-videos batch watch <manifest_file> --state-file <state> --json to poll jobs.",
    ],
    generation_execution: "sume_api",
    generation_runtime: "sume_api",
  },
  "avatar-videos.batch.watch": {
    command: "sume avatar-videos batch watch <manifest_file> --state-file <state> --json",
    description: "Poll jobs from a local avatar-video batch state file.",
    input_schema: objectSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        state_file: {
          ...stringProperty,
          description: "Local state file path. Defaults to <manifest_file>.state.json.",
        },
        interval_seconds: { type: "number", minimum: 0, default: 5 },
        timeout_seconds: { type: "number", minimum: 0, default: 300 },
      },
      ["manifest_file"],
    ),
    examples: [
      "sume avatar-videos batch watch ./videos.batch.json --state-file ./videos.state.json --timeout-seconds 0 --json",
    ],
    next_steps: [
      "Use sume avatar-videos batch result <manifest_file> --state-file <state> --json after completion.",
    ],
  },
  "avatar-videos.batch.result": {
    command: "sume avatar-videos batch result <manifest_file> --state-file <state> --json",
    description: "Fetch redacted job results for a local avatar-video batch state file.",
    input_schema: objectSchema(
      {
        manifest_file: { ...stringProperty, minLength: 1 },
        state_file: {
          ...stringProperty,
          description: "Local state file path. Defaults to <manifest_file>.state.json.",
        },
      },
      ["manifest_file"],
    ),
    examples: [
      "sume avatar-videos batch result ./videos.batch.json --state-file ./videos.state.json --json",
    ],
    next_steps: [
      "Use sume avatar-videos get <avatar_video_id> --agent --json to inspect resource metadata.",
      "Use sume jobs download <job_id> --output-dir <dir> --json when the user asks to save media locally.",
    ],
  },
};

const cliOnlyToolDefinitions: Record<string, StaticToolDefinition> = {
  "avatar-videos.batch.create": staticToolDefinitions["avatar-videos.batch.create"]!,
  "avatar-videos.batch.plan": staticToolDefinitions["avatar-videos.batch.plan"]!,
  "avatar-videos.batch.result": staticToolDefinitions["avatar-videos.batch.result"]!,
  "avatar-videos.batch.watch": staticToolDefinitions["avatar-videos.batch.watch"]!,
  "avatars.batch.create": staticToolDefinitions["avatars.batch.create"]!,
  "avatars.batch.plan": staticToolDefinitions["avatars.batch.plan"]!,
  "avatars.batch.result": staticToolDefinitions["avatars.batch.result"]!,
  "avatars.batch.watch": staticToolDefinitions["avatars.batch.watch"]!,
  "assets.download": staticToolDefinitions["assets.download"]!,
  "jobs.download": staticToolDefinitions["jobs.download"]!,
  "jobs.watch": staticToolDefinitions["jobs.watch"]!,
  "skills.export": staticToolDefinitions["skills.export"]!,
  "skills.install": staticToolDefinitions["skills.install"]!,
  "skills.list": staticToolDefinitions["skills.list"]!,
  "skills.remove": staticToolDefinitions["skills.remove"]!,
  "skills.update": staticToolDefinitions["skills.update"]!,
};

export const toolSchemas: ToolSchema[] = [
  ...mcpTools.map((tool) => buildSchema(tool.name, tool.description, tool.name)),
  ...Object.entries(cliOnlyToolDefinitions).map(([name, definition]) =>
    buildSchema(name, definition.description ?? name, null),
  ),
];

export function listToolSchemas() {
  return toolSchemas;
}

export function getToolSchema(name: string) {
  return toolSchemas.find((tool) => tool.name === name);
}

function buildSchema(
  name: string,
  description: string,
  mcpTool: string | null,
): ToolSchema {
  const mcpToolDefinition = mcpTool
    ? mcpTools.find((tool) => tool.name === mcpTool)
    : undefined;
  const definition = staticToolDefinitions[name] ?? {
    command: `sume ${name.replace(".", " ")} --json`,
    input_schema: objectSchema({}),
  };
  const safety = safetyForTool(name, mcpToolDefinition);
  const generationExecution =
    definition.generation_execution ??
    (safety.paid_generation_call ? "sume_api" : "none");
  const generationRuntime = definition.generation_runtime ?? "none";
  return {
    object: "tool_schema",
    name,
    command: definition.command,
    description: definition.description ?? description,
    input_schema: definition.input_schema,
    inputs: definition.input_schema,
    mcp_input_schema: mcpTool
      ? (definition.mcp_input_schema ?? definition.input_schema)
      : null,
    examples: definition.examples ?? examplesForTool(name),
    next_steps: definition.next_steps ?? nextStepsForTool(name),
    safety,
    execution: {
      cli_command: definition.command,
      mcp_tool: mcpTool,
      generation_execution: generationExecution,
      generation_runtime: generationRuntime,
    },
    ...(definition.confirmation ? { confirmation: definition.confirmation } : {}),
    ...(definition.constraints ? { constraints: definition.constraints } : {}),
  };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function passthroughObjectSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: "object",
    additionalProperties: true,
    properties,
    required,
  };
}

function submitCliSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    ...objectSchema(properties, required),
    anyOf: [
      {
        properties: { confirm_submit: { const: true } },
        required: ["confirm_submit"],
      },
      {
        properties: { confirm_paid: { const: true } },
        required: ["confirm_paid"],
      },
    ],
  };
}

function writeCliSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    ...objectSchema(properties, required),
    anyOf: [
      {
        properties: { confirm_submit: { const: true } },
        required: ["confirm_submit"],
      },
    ],
  };
}

function mcpSubmitSchema(payload: JsonSchema, description: string) {
  return objectSchema(
    {
      ...mcpSubmitProperties,
      payload: {
        ...payload,
        description,
      },
    },
    ["payload"],
  );
}

function safetyForTool(
  name: string,
  mcpTool: (typeof mcpTools)[number] | undefined,
): ToolSafety {
  if (mcpTool) {
    const mutating = !mcpTool.readOnly;
    const returnsSensitiveUrl = Boolean(mcpTool.returnsSensitiveUrl);
    return {
      mutating,
      paid_generation_call: Boolean(mcpTool.paidProviderCall),
      read_only: mcpTool.readOnly,
      requires_agent_redaction: mutating || returnsSensitiveUrl,
      requires_confirmation: mutating,
      returns_sensitive_url: returnsSensitiveUrl,
    };
  }
  const mutating = name.endsWith(".create");
  const jobRead = name.startsWith("jobs.");
  const assetTool = name.startsWith("assets.");
  const paidProviderCall = mutating && name !== "assets.create";
  const needsRedaction = mutating || jobRead || assetTool;
  return {
    mutating,
    paid_generation_call: paidProviderCall,
    read_only: !mutating,
    requires_agent_redaction: needsRedaction,
    requires_confirmation: mutating,
    returns_sensitive_url: needsRedaction,
  };
}

function examplesForTool(name: string) {
  if (name.startsWith("jobs.")) {
    return [`sume ${name.replace(".", " ")} <job_id> --agent --json`];
  }
  return [`sume ${name.replace(".", " ")} --json`];
}

function nextStepsForTool(name: string) {
  if (name.endsWith(".create")) {
    return [
      "Ask the user for explicit approval before adding --confirm-submit or --confirm-paid.",
      "Capture the returned request_id and monitor it with sume jobs watch <job_id> --agent --json.",
    ];
  }
  if (name.startsWith("jobs.")) {
    return [
      "Use --agent --json when reporting job data back through agents.",
      "Avoid echoing raw signed or private media URLs.",
    ];
  }
  return ["Run sume doctor --agent --json if local readiness is unclear."];
}

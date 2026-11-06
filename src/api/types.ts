/**
 * The parts of the Sume API this CLI reads. Field names follow the wire
 * format (snake_case) so a response can be printed with `--json` unchanged.
 * The full contract is the OpenAPI document the API serves at
 * `GET /v1/openapi.json`.
 */

export type ModelKind = "image" | "video" | "lipsync" | "captions";

/** Lower-case lifecycle state (`sume_status` on the status endpoint). */
export type JobState = "queued" | "processing" | "completed" | "failed" | "canceled";

export type NextAction = "poll_status" | "fetch_result" | "inspect_events";

export interface ApiErrorBody {
  code: string;
  message: string;
  request_id?: string;
  category?: string;
  stage?: string;
  retryable?: boolean;
  retry_after_seconds?: number | null;
  public_reason?: string;
  next_action?: string;
  details?: unknown;
}

export interface PriceOption {
  label: string;
  usd: string;
  usd_micros: number;
  route?: string;
  resolution?: string;
  quality?: string;
  [key: string]: unknown;
}

export interface CatalogModel {
  id: string;
  slug: string;
  name: string;
  kind: ModelKind;
  description?: string;
  modes?: string[];
  company: { slug: string; name: string };
  pricing: {
    currency: string;
    unit: string;
    from_usd: string;
    from_usd_micros: number;
    to_usd?: string;
    qualifier?: string;
    options?: PriceOption[];
  };
  capabilities?: Record<string, unknown>;
  constraints?: string[];
}

export interface Catalog {
  currency: string;
  models: CatalogModel[];
}

export interface Estimate {
  model: string;
  currency: string;
  usd: string;
  usd_micros: number;
  route?: string;
  billing?: {
    unit?: string;
    quantity?: number;
    duration_seconds?: number | null;
    resolution?: string | null;
  };
}

export interface Artifact {
  id: string;
  type: "image" | "video" | "audio" | "model" | "file";
  /** Set on intermediate files, like a video's `poster` frame. Final outputs have none. */
  stage?: string;
  url: string;
  content_type: string;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  checksum_sha256?: string | null;
}

export interface JobError {
  code?: string;
  message?: string;
  category?: string;
  stage?: string;
  retryable?: boolean;
  retry_after_seconds?: number | null;
  public_reason?: string;
  next_action?: string;
}

export interface Job {
  id: string;
  type: string;
  status: JobState;
  model: string | null;
  idempotency_key: string | null;
  communication_mode?: string;
  created_at: string;
  updated_at?: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at?: string | null;
  input?: Record<string, unknown>;
  result: { artifacts?: Artifact[]; [key: string]: unknown } | null;
  error: JobError | null;
}

/** Fields shared by the submit (`202`) and status responses. */
export interface JobActions {
  status_url: string;
  result_url: string;
  events_url: string;
  cancel_url: string | null;
  cancelable: boolean;
  next_action: NextAction;
  next_poll_after_seconds: number | null;
  recommended_poll_interval_seconds: number | null;
  retry_after_seconds: number | null;
  result_ready: boolean;
  terminal: boolean;
}

export interface SubmitResponse extends JobActions {
  request_id: string;
  job: Job;
  idempotency_hit: boolean;
  generation_limits?: Record<string, unknown>;
}

export interface StatusResponse extends JobActions {
  request_id: string;
  job_id: string;
  /** Queue-style spelling: IN_QUEUE, IN_PROGRESS, COMPLETED, FAILED, CANCELED. */
  status: string;
  sume_status: JobState;
  queue_position: number | null;
  job?: Job;
}

export interface ResultResponse {
  request_id: string;
  job_id: string;
  status: string;
  result: { artifacts?: Artifact[]; [key: string]: unknown } | null;
  job?: Job;
}

export interface CancelResponse {
  request_id: string;
  job_id: string;
  status: string;
  canceled: boolean;
  idempotency_hit: boolean;
  job: Job;
}

export interface JobList {
  jobs: Job[];
  next_cursor?: string;
}

export interface JobEvent {
  id: string;
  type: string;
  source?: string;
  status?: string;
  message?: string;
  created_at: string;
  data?: Record<string, unknown>;
}

export interface JobEvents {
  request_id: string;
  job_id: string;
  events: JobEvent[];
}

export interface Asset {
  id: string;
  media_type: "image" | "video" | "audio" | "file";
  status: string;
  url: string | null;
  content_type?: string | null;
  size_bytes?: number | null;
}

export interface UploadTarget {
  asset: Asset;
  upload: {
    asset_id?: string;
    /** Presigned and short-lived. Never log it. */
    url: string;
    method: string;
    /** Send exactly these with the PUT; `content-length` is signed. */
    headers: Record<string, string>;
    expires_at: string;
    max_bytes?: number;
  };
}

export interface Account {
  workspace_id: string;
  owner_user_id: string;
  api_key?: { id: string; name: string | null; prefix: string; scopes: string[] } | null;
  auth_source: string;
  [field: string]: unknown;
}

export interface Balance {
  available_credits: number;
  available_usd?: string;
  state: "funded" | "empty" | string;
  updated_at: string | null;
  expiration?: {
    next_expires_at?: string | null;
    next_expiring_credits?: number | null;
    expiring_soon_days?: number;
    expiring_soon_credits?: number;
  } | null;
  invoice?: Record<string, unknown> | null;
  [field: string]: unknown;
}

export interface UsageRow {
  id: string;
  request_id: string | null;
  job_id: string | null;
  operation_type: string;
  status: "reserved" | "captured" | "refunded" | string;
  credits: number;
  usd?: string;
  auth_source: string;
  created_at: string;
  [field: string]: unknown;
}

export interface Workspace {
  object?: "workspace";
  id: string;
  name: string;
  kind: "personal" | "team" | string;
  is_selected: boolean;
}

export interface WorkspaceList {
  object: "list";
  data: Workspace[];
  selected_workspace_id: string;
  switchable: boolean;
}

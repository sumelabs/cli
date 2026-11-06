import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A small stand-in for the Sume API: the catalog and estimate,
 * both routers, jobs, and direct upload, with the same envelopes and status
 * codes as the real API. Tests steer it through the public fields.
 */
export const TEST_KEY = "sume_live_test0000_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

export interface MockJob {
  id: string;
  type: string;
  model: string;
  status: "queued" | "processing" | "completed" | "failed" | "canceled";
  idempotency_key: string | null;
  input: Record<string, unknown>;
  created_at: string;
  /** Status reads left before the job moves on. */
  reads: number;
  outcome: "completed" | "failed";
  artifacts: number;
  poster: boolean;
  error: Record<string, unknown> | null;
}

export interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: unknown;
}

const MODELS = [
  {
    id: "gpt-image-2",
    slug: "openai/gpt-image-2",
    name: "ChatGPT Image 2",
    kind: "image",
    company: { slug: "openai", name: "OpenAI" },
    description: "Generates and edits images",
    modes: ["text-to-image", "image-edit"],
    pricing: {
      currency: "USD",
      unit: "image",
      from_usd: "0.0077",
      from_usd_micros: 7700,
      qualifier: "from",
      options: [
        { label: "low", usd: "0.0077", usd_micros: 7700, quality: "low" },
        { label: "high", usd: "0.2639", usd_micros: 263900, quality: "high" },
      ],
    },
    capabilities: { text_to_image: true, image_edit: true, qualities: ["low", "high"], max_images: 4 },
    constraints: [],
  },
  {
    id: "seedance-2-mini",
    slug: "bytedance/seedance-2-mini",
    name: "Seedance 2.0 Mini",
    kind: "video",
    company: { slug: "bytedance", name: "ByteDance" },
    modes: ["text-to-video", "image-to-video"],
    pricing: { currency: "USD", unit: "second", from_usd: "0.0879", from_usd_micros: 87900, qualifier: "from" },
    capabilities: {
      text_to_video: true,
      image_to_video: true,
      resolutions: ["480p", "720p"],
      duration_seconds: { min: 4, max: 15 },
    },
    constraints: [],
  },
  {
    id: "veed-lipsync",
    slug: "veed/veed-lipsync",
    name: "VEED Lipsync",
    kind: "lipsync",
    company: { slug: "veed", name: "VEED" },
    modes: ["video-to-lipsync"],
    pricing: { currency: "USD", unit: "second", from_usd: "0.0084", from_usd_micros: 8400, qualifier: "from" },
    capabilities: { video_to_video: true, lipsync: true, duration_seconds: { min: 2, max: 60 } },
    constraints: [],
  },
];

/**
 * A failure the mock serves instead of its normal answer, for the next
 * `times` requests whose method and path match.
 * - `drop`: close the connection without an answer.
 * - `drop-body`: send the headers and part of the body, then close.
 * - `html`: a proxy's error page, `status` (default 502) with HTML.
 * - `empty`: 200 with no body. `page`: 200 with an HTML page.
 * - `status`: the API's own JSON error with `status`.
 */
export interface Fault {
  method?: string;
  path: string | RegExp;
  times: number;
  kind: "drop" | "drop-body" | "html" | "empty" | "page" | "status";
  status?: number;
}

export class MockApi {
  readonly requests: Recorded[] = [];
  faults: Fault[] = [];
  readonly jobs = new Map<string, MockJob>();
  readonly uploads = new Map<string, { size: number; received: number; contentType: string }>();
  /** Answer the next N submits with this status (for retry tests). */
  failNextSubmits: { count: number; status: number; code: string } = { count: 0, status: 503, code: "database_busy" };
  /** Every new job ends like this. */
  nextOutcome: "completed" | "failed" = "completed";
  nextArtifacts = 1;
  /** Add a `stage: "poster"` frame to every new job's result. */
  nextPoster = false;
  /** Answer the next submits like a provider refusal: 502 with the job already failed. */
  refuseAtSubmit = false;
  readsUntilDone = 2;
  balanceUsd = 10;
  workspace = { id: "user_test", name: "Personal", kind: "personal" as "personal" | "team" };
  readonly teams = [
    { id: "user_test", name: "Personal", kind: "personal" as const },
    { id: "org_acme", name: "Acme Team", kind: "team" as const },
  ];
  readonly oauth = {
    tokenTtlSeconds: 3600,
    devicePendingPolls: 2,
    codes: new Map<string, { challenge: string; redirectUri: string; resource: string }>(),
    devices: new Map<string, { polls: number }>(),
    access: new Map<string, { family: string; expiresAt: number; revoked: boolean }>(),
    refresh: new Map<string, { family: string; used: boolean; revoked: boolean }>(),
    families: new Map<string, { workspace: string }>(),
    revoked: [] as string[],
    grants: [] as string[],
  };

  expireAccessTokens(): void {
    for (const token of this.oauth.access.values()) token.expiresAt = 0;
  }

  #issue(family: string) {
    const access = `mcp_at_${randomUUID().replaceAll("-", "")}`;
    const refresh = `mcp_rt_${randomUUID().replaceAll("-", "")}`;
    this.oauth.access.set(access, {
      family,
      expiresAt: Date.now() + this.oauth.tokenTtlSeconds * 1000,
      revoked: false,
    });
    this.oauth.refresh.set(refresh, { family, used: false, revoked: false });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: this.oauth.tokenTtlSeconds,
      refresh_token: refresh,
      scope: "mcp:read mcp:write",
    };
  }

  #session(authorization: string | undefined) {
    const bearer = authorization?.replace(/^Bearer /u, "") ?? "";
    const access = this.oauth.access.get(bearer);
    if (!access || access.revoked || access.expiresAt <= Date.now()) return undefined;
    return this.oauth.families.get(access.family);
  }
  url = "";
  #server: Server | undefined;

  async start(): Promise<this> {
    this.#server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "internal_error", message: String(error) } }));
      });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, "127.0.0.1", resolve));
    const { port } = this.#server.address() as AddressInfo;
    this.url = `http://127.0.0.1:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#server?.close(() => resolve()));
  }

  calls(method: string, prefix: string): Recorded[] {
    return this.requests.filter((r) => r.method === method && r.path.startsWith(prefix));
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const isJson = (req.headers["content-type"] ?? "").includes("json");
    const isForm = (req.headers["content-type"] ?? "").includes("x-www-form-urlencoded");
    const body =
      isJson && raw.length
        ? JSON.parse(raw.toString("utf8"))
        : isForm
          ? Object.fromEntries(new URLSearchParams(raw.toString("utf8")))
          : undefined;
    this.requests.push({ method: req.method ?? "GET", path: url.pathname, headers: req.headers, body });

    const fault = this.faults.find(
      (f) =>
        f.times > 0 &&
        (!f.method || f.method === req.method) &&
        (typeof f.path === "string" ? url.pathname.startsWith(f.path) : f.path.test(url.pathname)),
    );
    if (fault) {
      fault.times--;
      switch (fault.kind) {
        case "drop":
          req.socket.destroy();
          return;
        case "drop-body":
          res.writeHead(200, { "content-type": "application/json", "content-length": "5000" });
          res.write('{"data": {"partial"');
          setTimeout(() => req.socket.destroy(), 5);
          return;
        case "html":
          res.writeHead(fault.status ?? 502, { "content-type": "text/html" });
          res.end("<html><head><title>502 Bad Gateway</title></head><body><center>nginx</center></body></html>");
          return;
        case "empty":
          res.writeHead(200, { "content-type": "image/png", "content-length": "0" });
          res.end();
          return;
        case "page":
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end("<html><body>Sign in to the Wi-Fi</body></html>");
          return;
        case "status":
          res.writeHead(fault.status ?? 503, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { code: "unavailable", message: "Busy.", request_id: "req_fault", retryable: true },
            }),
          );
          return;
      }
    }

    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "x-sume-request-id": `req_${randomUUID().replaceAll("-", "")}`,
        ...headers,
      });
      res.end(JSON.stringify(payload));
    };
    const error = (status: number, code: string, message = code, extra: Record<string, unknown> = {}) =>
      send(status, { error: { code, message, request_id: "req_test", retryable: status >= 500, ...extra } });
    const signedIn = this.#session(req.headers.authorization);
    const authed = () => req.headers.authorization === `Bearer ${TEST_KEY}` || signedIn !== undefined;
    const path = url.pathname;
    const issuer = this.url;
    const clientId = `${issuer}/oauth/clients/sume-cli`;
    const oauthError = (status: number, code: string, description: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: code, error_description: description }));
    };

    if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
      return send(200, {
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        scopes_supported: ["mcp:read", "mcp:write"],
      });
    }
    if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        device_authorization_endpoint: `${issuer}/oauth/device_authorization`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (req.method === "GET" && path === "/oauth/authorize") {
      const q = url.searchParams;
      const redirect = q.get("redirect_uri") ?? "";
      const loopback = /^http:\/\/127\.0\.0\.1:\d+\/callback$/u.test(redirect);
      if (q.get("client_id") !== clientId || !loopback || q.get("code_challenge_method") !== "S256") {
        return oauthError(400, "invalid_request", "Bad authorization request.");
      }
      if (q.get("resource") !== new URL(issuer).origin) return oauthError(400, "invalid_target", "Unknown resource.");
      const code = `mcp_ac_${randomUUID()}`;
      this.oauth.codes.set(code, {
        challenge: q.get("code_challenge") ?? "",
        redirectUri: redirect,
        resource: q.get("resource") ?? "",
      });
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state") ?? "");
      back.searchParams.set("iss", issuer);
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (req.method === "POST" && path === "/oauth/device_authorization") {
      if (body?.client_id !== clientId) return oauthError(401, "invalid_client", "Unknown client.");
      const device = `mcp_dc_${randomUUID()}`;
      this.oauth.devices.set(device, { polls: this.oauth.devicePendingPolls });
      return send(200, {
        device_code: device,
        user_code: "ABCD-EFGH",
        verification_uri: `${issuer}/oauth/device`,
        verification_uri_complete: `${issuer}/oauth/device?user_code=ABCD-EFGH`,
        expires_in: 600,
        interval: 5,
      });
    }
    if (req.method === "POST" && path === "/oauth/token") {
      if (body?.client_id !== clientId) return oauthError(401, "invalid_client", "Unknown client.");
      this.oauth.grants.push(String(body.grant_type));
      if (body.grant_type === "authorization_code") {
        const grant = this.oauth.codes.get(String(body.code));
        this.oauth.codes.delete(String(body.code));
        const verifier = createHash("sha256")
          .update(String(body.code_verifier ?? ""))
          .digest("base64url");
        if (
          !grant ||
          grant.challenge !== verifier ||
          grant.redirectUri !== body.redirect_uri ||
          grant.resource !== body.resource
        ) {
          return oauthError(400, "invalid_grant", "The code, verifier or redirect does not match.");
        }
        const family = randomUUID();
        this.oauth.families.set(family, { workspace: "user_test" });
        return send(200, this.#issue(family));
      }
      if (body.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
        const device = this.oauth.devices.get(String(body.device_code));
        if (!device) return oauthError(400, "expired_token", "The code expired.");
        if (device.polls > 0) {
          device.polls--;
          return oauthError(400, "authorization_pending", "Waiting for the person to approve the sign-in.");
        }
        this.oauth.devices.delete(String(body.device_code));
        const family = randomUUID();
        this.oauth.families.set(family, { workspace: "user_test" });
        return send(200, this.#issue(family));
      }
      if (body.grant_type === "refresh_token") {
        const token = this.oauth.refresh.get(String(body.refresh_token));
        if (!token || token.revoked) return oauthError(400, "invalid_grant", "Refresh token is invalid.");
        if (token.used) {
          for (const t of this.oauth.refresh.values()) if (t.family === token.family) t.revoked = true;
          for (const t of this.oauth.access.values()) if (t.family === token.family) t.revoked = true;
          return oauthError(400, "invalid_grant", "Refresh token was already used.");
        }
        token.used = true;
        return send(200, this.#issue(token.family));
      }
      return oauthError(400, "unsupported_grant_type", "Unsupported grant.");
    }
    if (req.method === "POST" && path === "/oauth/revoke") {
      const token = String(body?.token ?? "");
      this.oauth.revoked.push(token);
      const refresh = this.oauth.refresh.get(token);
      if (refresh) {
        for (const t of this.oauth.refresh.values()) if (t.family === refresh.family) t.revoked = true;
        for (const t of this.oauth.access.values()) if (t.family === refresh.family) t.revoked = true;
      }
      const access = this.oauth.access.get(token);
      if (access) access.revoked = true;
      res.writeHead(200);
      res.end();
      return;
    }

    // Files the API "serves" from its CDN.
    if (req.method === "GET" && path.startsWith("/media/")) {
      res.writeHead(200, { "content-type": "image/png", "content-length": String(PNG.length) });
      res.end(PNG);
      return;
    }
    if (req.method === "PUT" && path.startsWith("/storage/")) {
      const id = path.split("/")[2] as string;
      const upload = this.uploads.get(id);
      if (!upload || req.headers.authorization) return error(403, "forbidden");
      upload.received = raw.length;
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      return send(
        200,
        { service: "mock", status: "ok", build: { commit_sha: "0123456789abcdef", source_branch: "v9.9.9" } },
        { "x-sume-api-surface": "public" },
      );
    }
    if (req.method === "GET" && path === "/v1/open/catalog")
      return send(200, { data: { currency: "USD", models: MODELS } });
    if (req.method === "GET" && path.startsWith("/v1/open/catalog/")) {
      const model = MODELS.find((m) => m.id === decodeURIComponent(path.split("/").pop() ?? ""));
      return model ? send(200, { data: model }) : error(404, "model_not_found", "No such model.");
    }
    if (req.method === "POST" && path === "/v1/open/estimate") {
      const model = MODELS.find((m) => m.id === body?.model);
      if (!model) return error(404, "model_not_found");
      if (model.kind === "lipsync") {
        for (const field of ["video_url", "audio_url"]) {
          const value = body.input?.[field];
          if (typeof value === "string" && new URL(value).hostname === "upload.invalid") {
            return error(
              400,
              "media_unreadable",
              `${field} could not be read: its host name does not exist. Send a public HTTPS URL to a playable file, or upload it to Sume first.`,
              { details: { field, reason: "no_such_host", source_host: "upload.invalid" } },
            );
          }
        }
      }
      // Like the real estimate, a duration past the model's limit is priced at the limit.
      const duration = Math.min(Number(body.input?.duration ?? 0), 15);
      const usd = model.kind === "image" ? 0.0077 : 0.0879 * Math.max(duration, 1);
      return send(200, {
        data: {
          model: model.id,
          currency: "USD",
          usd: usd.toFixed(4),
          usd_micros: Math.round(usd * 1e6),
          route: "test",
          billing: { unit: "usd_micros", quantity: 1, duration_seconds: duration || null, resolution: null },
        },
      });
    }

    if (!authed()) return error(401, "unauthorized", "Missing or invalid API key.");

    if (req.method === "POST" && /^\/v1\/(image|video)-router\/generate$/u.test(path)) {
      if (this.failNextSubmits.count > 0) {
        this.failNextSubmits.count--;
        return error(this.failNextSubmits.status, this.failNextSubmits.code, "Try again.", {
          retry_after_seconds: null,
        });
      }
      if (this.balanceUsd <= 0) {
        return error(402, "insufficient_funds", "Balance too low.", {
          details: { required_usd: "0.0077", available_usd: "0.00" },
        });
      }
      if (!body?.model)
        return error(400, "invalid_request", "Invalid request body.", {
          details: { errors: [{ path: "model", message: "must have required property 'model'" }] },
        });
      const key = (req.headers["idempotency-key"] as string | undefined) ?? null;
      if (this.refuseAtSubmit) {
        const job = this.#createJob("image_generation", body, key);
        job.status = "failed";
        job.error = {
          code: "provider_submission_failed",
          message: 'Application "imagen4" not found',
          retryable: false,
        };
        return error(502, "provider_submission_failed", 'Application "imagen4" not found', {
          retryable: false,
          details: { request_id: job.id, job: this.#jobView(job) },
        });
      }
      const existing = key ? [...this.jobs.values()].find((j) => j.idempotency_key === key) : undefined;
      const job =
        existing ?? this.#createJob(path.includes("image") ? "image_generation" : "video_generation", body, key);
      return send(existing ? 200 : 202, {
        data: {
          ...this.#actions(job),
          request_id: job.id,
          job: this.#jobView(job),
          idempotency_hit: Boolean(existing),
        },
      });
    }

    if (req.method === "GET" && path === "/v1/me") {
      return send(200, {
        data: {
          account: signedIn
            ? {
                workspace_id: signedIn.workspace,
                owner_user_id: "user_test",
                api_key: {
                  id: `mcp_oauth_token_${randomUUID()}`,
                  name: "Sume sign-in",
                  prefix: "mcp_at_abcd",
                  scopes: ["mcp:read", "account:read"],
                },
                auth_source: "ledger",
              }
            : {
                workspace_id: this.workspace.id,
                owner_user_id: "user_test",
                api_key: { id: "key_test", name: "test key", prefix: TEST_KEY.slice(0, 18), scopes: ["account:read"] },
                auth_source: "ledger",
              },
        },
      });
    }
    if (req.method === "GET" && path === "/v1/balance") {
      const credits = Math.floor(this.balanceUsd * 62.5);
      return send(200, {
        data: {
          balance: {
            available_credits: credits,
            available_usd: this.balanceUsd.toFixed(2),
            state: credits > 0 ? "funded" : "empty",
            updated_at: new Date().toISOString(),
            expiration: {
              next_expires_at: null,
              next_expiring_credits: 0,
              expiring_soon_days: 30,
              expiring_soon_credits: 0,
            },
          },
        },
      });
    }
    if (req.method === "GET" && path === "/v1/usage") {
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const job = url.searchParams.get("job_id");
      const rows = [...this.jobs.values()]
        .reverse()
        .filter((j) => !job || j.id === job)
        .map((j, i) => ({
          id: `usage_${i}`,
          request_id: j.id,
          job_id: j.id,
          operation_type: j.type,
          status: j.status === "failed" ? "refunded" : "captured",
          credits: 1,
          usd: "0.0077",
          auth_source: "api_key",
          created_at: j.created_at,
          updated_at: j.created_at,
          captured_at: j.created_at,
          refunded_at: null,
        }));
      return send(200, { data: { usage: rows.slice(0, limit), limit } });
    }
    if (req.method === "GET" && path === "/v1/workspaces") {
      if (signedIn) {
        return send(200, {
          object: "list",
          data: this.teams.map((w) => ({ object: "workspace", ...w, is_selected: w.id === signedIn.workspace })),
          selected_workspace_id: signedIn.workspace,
          switchable: true,
        });
      }
      return send(200, {
        object: "list",
        data: [{ object: "workspace", ...this.workspace, is_selected: true }],
        selected_workspace_id: this.workspace.id,
        switchable: false,
      });
    }
    if (req.method === "POST" && path === "/v1/workspaces/select" && signedIn) {
      const next = this.teams.find((w) => w.id === body?.workspace_id);
      if (!next) return error(404, "workspace_not_found", "No such workspace.");
      const previous = signedIn.workspace;
      signedIn.workspace = next.id;
      return send(200, {
        object: "workspace_selection",
        workspace: { object: "workspace", ...next, is_selected: true },
        previous_workspace_id: previous,
      });
    }
    if (req.method === "POST" && path === "/v1/workspaces/select") {
      return error(
        409,
        "workspace_fixed",
        "This credential belongs to one workspace. Sign in with Sume (an MCP connection or sume login) to switch workspaces.",
      );
    }

    const jobMatch = /^\/v1\/jobs\/([^/]+)(?:\/(status|result|cancel|events))?$/u.exec(path);
    if (req.method === "GET" && path === "/v1/jobs") {
      const jobs = [...this.jobs.values()].reverse().map((j) => this.#jobView(j));
      return send(200, { data: { jobs: jobs.slice(0, Number(url.searchParams.get("limit") ?? 20)) } });
    }
    if (jobMatch) {
      const job = this.jobs.get(decodeURIComponent(jobMatch[1] as string));
      if (!job) return error(404, "not_found", "API job was not found.");
      const action = jobMatch[2];
      if (req.method === "GET" && !action) return send(200, { data: { job: this.#jobView(job) } });
      if (req.method === "GET" && action === "status") {
        this.#advance(job);
        const upper = {
          queued: "IN_QUEUE",
          processing: "IN_PROGRESS",
          completed: "COMPLETED",
          failed: "FAILED",
          canceled: "CANCELED",
        }[job.status];
        return send(200, {
          data: {
            ...this.#actions(job),
            request_id: job.id,
            job_id: job.id,
            status: upper,
            sume_status: job.status,
            queue_position: null,
            job: this.#jobView(job),
          },
        });
      }
      if (req.method === "GET" && action === "result") {
        if (job.status !== "completed")
          return error(409, "job_not_completed", "Not done.", { details: { status: job.status } });
        return send(200, {
          data: {
            request_id: job.id,
            job_id: job.id,
            status: "COMPLETED",
            result: this.#result(job),
            job: this.#jobView(job),
          },
        });
      }
      if (req.method === "POST" && action === "cancel") {
        if (job.status !== "queued")
          return error(409, "job_not_cancelable", "API job can only be canceled before generation starts.");
        job.status = "canceled";
        return send(200, {
          data: {
            request_id: job.id,
            job_id: job.id,
            status: "CANCELED",
            canceled: true,
            idempotency_hit: false,
            job: this.#jobView(job),
          },
        });
      }
      if (req.method === "GET" && action === "events") {
        const events = [
          { id: "evt_1", type: "job.created", status: "info", message: "Job created.", created_at: job.created_at },
          {
            id: "evt_2",
            type: job.status === "failed" ? "job.failed" : "job.completed",
            status: job.status === "failed" ? "failed" : "succeeded",
            created_at: new Date(Date.parse(job.created_at) + 4200).toISOString(),
            // Like the real API, the failed event carries no reason; the job does.
            data: { terminal_event_status: job.status },
          },
        ];
        return send(200, { data: { request_id: job.id, job_id: job.id, events } });
      }
    }

    if (req.method === "POST" && path === "/v1/assets/upload-url") {
      const id = `asset_${randomUUID().slice(0, 8)}`;
      this.uploads.set(id, { size: body.size_bytes, received: 0, contentType: body.content_type });
      return send(201, {
        data: {
          asset: { id, media_type: "image", status: "pending_upload", url: null },
          upload: {
            asset_id: id,
            url: `${this.url}/storage/${id}`,
            method: "PUT",
            headers: { "content-type": body.content_type },
            expires_at: new Date(Date.now() + 600_000).toISOString(),
          },
        },
      });
    }
    const complete = /^\/v1\/assets\/([^/]+)\/complete$/u.exec(path);
    if (req.method === "POST" && complete) {
      const id = complete[1] as string;
      const upload = this.uploads.get(id);
      if (!upload) return error(404, "not_found");
      if (upload.received !== upload.size)
        return error(409, "upload_incomplete", "The stored object's size does not match.");
      return send(200, {
        data: { asset: { id, media_type: "image", status: "ready", url: `${this.url}/media/${id}.png` } },
      });
    }

    return error(404, "not_found", `No route ${req.method} ${path}`);
  }

  #createJob(type: string, body: Record<string, unknown>, key: string | null): MockJob {
    const { model, ...input } = body;
    const job: MockJob = {
      id: `job_${randomUUID()}`,
      type,
      model: String(model),
      status: "queued",
      idempotency_key: key,
      input,
      created_at: new Date().toISOString(),
      reads: this.readsUntilDone,
      outcome: this.nextOutcome,
      artifacts: this.nextArtifacts,
      poster: this.nextPoster,
      error: null,
    };
    this.jobs.set(job.id, job);
    return job;
  }

  #advance(job: MockJob): void {
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") return;
    job.reads--;
    if (job.reads > 0) {
      job.status = "processing";
      return;
    }
    job.status = job.outcome;
    if (job.outcome === "failed") {
      job.error = {
        code: "generation_failed",
        message: "The model refused the prompt.",
        category: "generation_rejected",
        retryable: false,
      };
    }
  }

  #result(job: MockJob) {
    const artifacts: Record<string, unknown>[] = Array.from({ length: job.artifacts }, (_, i) => ({
      id: `artf_${i}`,
      type: "image",
      url: `${this.url}/media/${job.id}-${i}.png`,
      content_type: "image/png",
      width: 1,
      height: 1,
    }));
    if (job.poster) {
      artifacts.push({
        id: "artf_poster",
        type: "image",
        stage: "poster",
        url: `${this.url}/media/${job.id}-poster.jpg`,
        content_type: "image/jpeg",
      });
    }
    return { artifacts };
  }

  #jobView(job: MockJob) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      model: job.model,
      idempotency_key: job.idempotency_key,
      created_at: job.created_at,
      started_at: job.created_at,
      completed_at: job.status === "completed" || job.status === "failed" ? new Date().toISOString() : null,
      input: job.input,
      result: job.status === "completed" ? this.#result(job) : null,
      error: job.error,
    };
  }

  #actions(job: MockJob) {
    const terminal = ["completed", "failed", "canceled"].includes(job.status);
    return {
      status_url: `${this.url}/v1/jobs/${job.id}/status`,
      result_url: `${this.url}/v1/jobs/${job.id}/result`,
      events_url: `${this.url}/v1/jobs/${job.id}/events`,
      cancel_url: job.status === "queued" ? `${this.url}/v1/jobs/${job.id}/cancel` : null,
      cancelable: job.status === "queued",
      next_action: job.status === "completed" ? "fetch_result" : terminal ? "inspect_events" : "poll_status",
      // Tests poll fast; the CLI clamps to at least one second, so tests use 0 through a fake sleep.
      next_poll_after_seconds: terminal ? null : 1,
      recommended_poll_interval_seconds: terminal ? null : 1,
      retry_after_seconds: null,
      result_ready: job.status === "completed",
      terminal,
    };
  }
}

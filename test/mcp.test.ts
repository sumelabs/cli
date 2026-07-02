import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SumeApiClient } from "../src/lib/api-client.js";
import {
  buildMcpDoctorReport,
  buildMcpInstallDryRun,
  installMcpClientConfig,
  inspectMcpClientConfig,
  supportedMcpClientAgents,
} from "../src/lib/mcp-client-config.js";
import { listToolSchemas } from "../src/lib/tool-registry.js";
import { formatMcpToolResponse } from "../src/mcp/server.js";
import {
  listMcpTools,
  mcpNextStepsForTool,
  mcpTools,
} from "../src/mcp/tools.js";

function words(count: number) {
  return Array.from({ length: count }, (_value, index) => `word${index}`).join(
    " ",
  );
}

describe("MCP tool registry", () => {
  it("exposes only read-only starter tools by default", () => {
    expect(listMcpTools().map((tool) => tool.name)).toEqual([
      "tools.list",
      "tools.schema",
      "health.service",
      "health.v1",
      "account.me",
      "balance.get",
      "usage.get",
      "catalog.list",
      "jobs.list",
      "jobs.get",
      "jobs.status",
      "jobs.result",
      "jobs.events",
      "jobs.wait",
      "avatars.list",
      "avatars.get",
      "avatars.wait",
      "avatar-videos.list",
      "avatar-videos.get",
    ]);
    expect(listMcpTools().every((tool) => tool.read_only)).toBe(true);
  });

  it("requires explicit write and paid opt-in for submit tools", () => {
    expect(
      listMcpTools({
        toolsets: ["assets"],
      }).map((tool) => tool.name),
    ).toEqual(["assets.list", "assets.get", "assets.download_url"]);
    expect(
      listMcpTools({
        allowWrite: true,
        toolsets: ["assets"],
      }).map((tool) => tool.name),
    ).toEqual([
      "assets.list",
      "assets.get",
      "assets.upload_url",
      "assets.upload_file",
      "assets.complete",
      "assets.download_url",
      "assets.create",
    ]);
    expect(
      listMcpTools({
        toolsets: ["avatars", "avatar-videos"],
      }).map((tool) => tool.name),
    ).toEqual([
      "avatars.list",
      "avatars.get",
      "avatars.wait",
      "avatar-videos.list",
      "avatar-videos.get",
    ]);
    expect(
      listMcpTools({
        allowWrite: true,
        toolsets: ["avatars", "avatar-videos"],
      }).map((tool) => tool.name),
    ).toEqual([
      "avatars.list",
      "avatars.get",
      "avatars.wait",
      "avatar-videos.list",
      "avatar-videos.get",
    ]);
    expect(
      listMcpTools({
        allowPaid: true,
        allowWrite: true,
        toolsets: ["avatars", "avatar-videos"],
      }).map((tool) => tool.name),
    ).toEqual([
      "avatars.list",
      "avatars.get",
      "avatars.wait",
      "avatars.create",
      "avatars.create_prompt",
      "avatars.create_props",
      "avatars.create_photo_url",
      "avatar-videos.list",
      "avatar-videos.get",
      "avatar-videos.create",
    ]);
    expect(
      Object.keys(
        mcpTools.find((candidate) => candidate.name === "avatar-videos.create")
          ?.inputSchema.shape ?? {},
      ).sort(),
    ).toEqual([
      "aspect_ratio",
      "avatar_handle",
      "dry_run",
      "idempotency_key",
      "max_spend_usd",
      "mode",
      "payload",
      "product_image",
      "quality",
      "resolution",
      "scene_image_url",
      "scene_prompt",
      "script",
      "title",
      "wait_timeout_seconds",
      "webhook_url",
    ]);
    expect(
      listMcpTools({
        allowPaid: true,
        allowWrite: true,
        toolsets: ["avatars"],
      }),
    ).toEqual([
      expect.objectContaining({
        name: "avatars.list",
        paid_generation_call: false,
        generation_runtime: "none",
        returns_sensitive_url: true,
      }),
      expect.objectContaining({
        name: "avatars.get",
        paid_generation_call: false,
        generation_runtime: "none",
        returns_sensitive_url: true,
      }),
      expect.objectContaining({
        name: "avatars.wait",
        paid_generation_call: false,
        generation_runtime: "none",
        returns_sensitive_url: true,
      }),
      expect.objectContaining({
        name: "avatars.create",
        paid_generation_call: true,
        future_paid_generation_call: false,
        generation_runtime: "sume_api",
        returns_sensitive_url: true,
      }),
      expect.objectContaining({
        name: "avatars.create_prompt",
        paid_generation_call: true,
        future_paid_generation_call: false,
        generation_runtime: "sume_api",
        returns_sensitive_url: true,
      }),
      expect.objectContaining({
        name: "avatars.create_props",
        paid_generation_call: true,
        future_paid_generation_call: false,
        generation_runtime: "sume_api",
        returns_sensitive_url: true,
      }),
      expect.objectContaining({
        name: "avatars.create_photo_url",
        paid_generation_call: true,
        future_paid_generation_call: false,
        generation_runtime: "sume_api",
        returns_sensitive_url: true,
      }),
    ]);
  });

  it("keeps read-only and submit tools classified separately", () => {
    expect(
      mcpTools.filter((tool) => tool.readOnly).map((tool) => tool.name),
    ).toEqual([
      "tools.list",
      "tools.schema",
      "health.service",
      "health.v1",
      "account.me",
      "balance.get",
      "usage.get",
      "catalog.list",
      "jobs.list",
      "jobs.get",
      "jobs.status",
      "jobs.result",
      "jobs.events",
      "jobs.wait",
      "assets.list",
      "assets.get",
      "assets.download_url",
      "avatars.list",
      "avatars.get",
      "avatars.wait",
      "avatar-videos.list",
      "avatar-videos.get",
    ]);
    expect(
      mcpTools.filter((tool) => !tool.readOnly).map((tool) => tool.name),
    ).toEqual([
      "jobs.cancel",
      "assets.upload_url",
      "assets.upload_file",
      "assets.complete",
      "assets.create",
      "avatars.create",
      "avatars.create_prompt",
      "avatars.create_props",
      "avatars.create_photo_url",
      "avatar-videos.create",
    ]);
  });

  it("validates tool inputs before execution", () => {
    const tool = mcpTools.find((candidate) => candidate.name === "jobs.get");
    expect(() => tool?.inputSchema.parse({ job_id: "" })).toThrow();
    expect(tool?.inputSchema.parse({ job_id: "job_123" })).toEqual({
      job_id: "job_123",
    });
    const propsTool = mcpTools.find(
      (candidate) => candidate.name === "avatars.create_props",
    );
    expect(() =>
      propsTool?.inputSchema.parse({
        age: 81,
        ethnicity: "Asian",
        idempotency_key: "props-age-1",
        max_spend_usd: 1,
        name: "Presenter",
        sex: "female",
      }),
    ).toThrow();
  });

  it("adds redacted next steps to MCP responses", () => {
    const response = formatMcpToolResponse("avatars.create", {
      request_id: "request_123",
      status_url: "https://example.com/status/request_123",
      job: { id: "job_123", result_url: "https://example.com/result/job_123" },
    });
    const body = JSON.parse(response.content[0].text);
    expect(body).toMatchObject({
      request_id: "request_123",
      status_url: "[redacted]",
      job: { id: "job_123", result_url: "[redacted]" },
      agent: {
        safe: true,
        redacted_count: 2,
        next_steps: expect.arrayContaining([
          expect.stringContaining("avatars.wait"),
          expect.stringContaining("avatar_summary.job_id"),
        ]),
      },
    });
    expect(mcpNextStepsForTool("jobs.result")).toEqual(
      expect.arrayContaining([expect.stringContaining("Do not echo raw")]),
    );
  });

  it("marks job and submit tools as URL-returning in metadata", () => {
    expect(listMcpTools()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "jobs.result",
          returns_sensitive_url: true,
        }),
        expect.objectContaining({
          name: "account.me",
          returns_sensitive_url: false,
        }),
      ]),
    );
    expect(listMcpTools({ toolsets: ["assets"] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "assets.get",
          returns_sensitive_url: true,
        }),
      ]),
    );
  });

  it("keeps MCP tool metadata consistent with local schema contracts", () => {
    const schemas = listToolSchemas();
    for (const tool of mcpTools) {
      const schema = schemas.find((candidate) => candidate.name === tool.name);
      if (!schema) {
        expect(
          tool.name,
          `${tool.name} should be an MCP-only prelaunch helper`,
        ).toMatch(
          /^(assets\.upload_file|jobs\.wait|avatars\.wait|avatars\.create_(prompt|props|photo_url))$/,
        );
        continue;
      }
      expect(schema.execution.mcp_tool).toBeNull();
      expect(schema.mcp).toEqual({
        status: "coming_soon",
        launched: false,
      });
      expect(schema?.safety).toMatchObject({
        mutating: !tool.readOnly,
        paid_generation_call: Boolean(tool.paidProviderCall),
        read_only: tool.readOnly,
        requires_confirmation: !tool.readOnly,
        returns_sensitive_url: Boolean(tool.returnsSensitiveUrl),
      });
    }
  });

  it("exposes local tool schemas through MCP tools without API calls", async () => {
    const calls: string[] = [];
    const client = {
      get: async (path: string) => {
        calls.push(path);
        return { ok: true };
      },
      post: async (path: string) => {
        calls.push(path);
        return { ok: true };
      },
      uploadToSignedUrl: async () => {
        calls.push("signed-upload");
        return { ok: true };
      },
    } as unknown as SumeApiClient;

    const list = await mcpTools
      .find((candidate) => candidate.name === "tools.list")
      ?.execute({}, client);
    const schema = await mcpTools
      .find((candidate) => candidate.name === "tools.schema")
      ?.execute({ name: "assets.create" }, client);

    expect(calls).toEqual([]);
    expect(list).toMatchObject({
      object: "tool_schema_list",
      count: expect.any(Number),
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "assets.create" }),
      ]),
    });
    expect(JSON.stringify(list)).not.toContain("assets.upload_file");
    expect(schema).toMatchObject({
      name: "assets.create",
      confirmation: {
        accepted_flags: ["confirm_submit"],
        required: true,
      },
      mcp_input_schema: null,
      mcp: {
        status: "coming_soon",
        launched: false,
      },
      safety: {
        mutating: true,
        paid_generation_call: false,
        read_only: false,
      },
    });
  });

  it("maps tools to current sume.com API paths", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
      query?: unknown;
    }> = [];
    const client = {
      get: async (path: string, options?: { query?: unknown }) => {
        calls.push({ path, query: options?.query });
        return { ok: true };
      },
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 85_525 },
            },
          };
        }
        return { ok: true };
      },
    } as unknown as SumeApiClient;

    await mcpTools
      .find((candidate) => candidate.name === "health.service")
      ?.execute({}, client);
    await mcpTools
      .find((candidate) => candidate.name === "health.v1")
      ?.execute({}, client);
    await mcpTools
      .find((candidate) => candidate.name === "account.me")
      ?.execute({}, client);
    await mcpTools
      .find((candidate) => candidate.name === "balance.get")
      ?.execute({}, client);
    await mcpTools
      .find((candidate) => candidate.name === "usage.get")
      ?.execute({ limit: 7 }, client);
    await mcpTools
      .find((candidate) => candidate.name === "catalog.list")
      ?.execute({}, client);
    await mcpTools
      .find((candidate) => candidate.name === "jobs.list")
      ?.execute({ limit: 5 }, client);
    await mcpTools
      .find((candidate) => candidate.name === "jobs.status")
      ?.execute({ job_id: "job_123" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "jobs.result")
      ?.execute({ job_id: "job_123" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "jobs.events")
      ?.execute({ job_id: "job_123", limit: 25 }, client);
    await mcpTools
      .find((candidate) => candidate.name === "jobs.wait")
      ?.execute({ job_id: "job_123", timeout_seconds: 0 }, client);
    await mcpTools
      .find((candidate) => candidate.name === "jobs.cancel")
      ?.execute({ job_id: "job_123", idempotency_key: "cancel-1" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "assets.list")
      ?.execute({ limit: 10, media_type: "image", status: "ready" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "assets.get")
      ?.execute({ asset_id: "asset_123" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "assets.upload_url")
      ?.execute(
        {
          idempotency_key: "upload-1",
          payload: {
            content_type: "image/png",
            size_bytes: 1000,
            media_type: "image",
          },
        },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "assets.complete")
      ?.execute(
        {
          asset_id: "asset_123",
          idempotency_key: "complete-1",
          payload: { size_bytes: 1000 },
        },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "assets.download_url")
      ?.execute({ asset_id: "asset_123" }, client);
    await mcpTools.find((candidate) => candidate.name === "assets.create")?.execute(
      {
        idempotency_key: "asset-request-1",
        payload: {
          source_url: "https://example.com/reference.png",
          media_type: "image",
        },
      },
      client,
    );
    await mcpTools.find((candidate) => candidate.name === "avatars.create")?.execute(
      {
        idempotency_key: "request-1",
        max_spend_usd: 1,
        payload: {
          avatar_handle: "presenter",
          input: {
            type: "prompt",
            prompt: "Hello",
          },
        },
      },
      client,
    );
    await mcpTools.find((candidate) => candidate.name === "avatars.create")?.execute(
      {
        idempotency_key: "request-high-1",
        max_spend_usd: 1,
        payload: {
          avatar_handle: "presenter_two",
          input: {
            type: "prompt",
            prompt: "Hello again",
          },
        },
      },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "avatars.wait")
      ?.execute({ job_id: "job_123", timeout_seconds: 0 }, client);
    await mcpTools
      .find((candidate) => candidate.name === "avatars.create_prompt")
      ?.execute(
        {
          idempotency_key: "request-prompt-1",
          max_spend_usd: 1,
          avatar_handle: "prompt_presenter",
          prompt: "A friendly presenter",
        },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "avatars.create_props")
      ?.execute(
        {
          age: 32,
          avatar_handle: "profile_presenter",
          ethnicity: "Asian",
          idempotency_key: "request-props-1",
          max_spend_usd: 1,
          sex: "female",
        },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "avatars.create_photo_url")
      ?.execute(
        {
          dry_run: true,
          idempotency_key: "request-photo-1",
          max_spend_usd: 1,
          avatar_handle: "photo_presenter",
          image_url: "https://media.sume.com/artifacts/mcp-avatar-photo-dry-run/reference.png",
        },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "avatars.list")
      ?.execute({ handle: "@studio_presenter", status: "ready" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "avatars.get")
      ?.execute({ avatar_id: "avatar_123" }, client);
    await mcpTools
      .find((candidate) => candidate.name === "avatar-videos.create")
      ?.execute(
        {
          idempotency_key: "video-request-1",
          max_spend_usd: 1,
          payload: {
            script: "Hello",
            product_image: "https://example.com/product.png",
            avatar_handle: "avatar_123",
          },
        },
        client,
      );
    await mcpTools
      .find((candidate) => candidate.name === "avatar-videos.list")
      ?.execute({}, client);
    await mcpTools
      .find((candidate) => candidate.name === "avatar-videos.get")
      ?.execute({ avatar_video_id: "avatar_video_123" }, client);
    expect(calls).toEqual([
      { path: "/../health", query: undefined },
      { path: "/health", query: undefined },
      { path: "/me", query: undefined },
      { path: "/balance", query: undefined },
      { path: "/usage", query: { limit: 7 } },
      { path: "/catalog", query: undefined },
      { path: "/jobs", query: { limit: 5 } },
      { path: "/jobs/job_123/status", query: undefined },
      { path: "/jobs/job_123/result", query: undefined },
      { path: "/jobs/job_123/events", query: { limit: 25 } },
      { path: "/jobs/job_123/status", query: undefined },
      {
        path: "/jobs/job_123/cancel",
        body: {},
        headers: { "Idempotency-Key": "cancel-1" },
      },
      {
        path: "/assets",
        query: {
          cursor: undefined,
          limit: 10,
          media_type: "image",
          status: "ready",
        },
      },
      { path: "/assets/asset_123", query: undefined },
      {
        path: "/assets/upload-url",
        body: {
          content_type: "image/png",
          size_bytes: 1000,
          media_type: "image",
        },
        headers: { "Idempotency-Key": "upload-1" },
      },
      {
        path: "/assets/asset_123/complete",
        body: { size_bytes: 1000 },
        headers: { "Idempotency-Key": "complete-1" },
      },
      { path: "/assets/asset_123/download-url", query: undefined },
      {
        path: "/assets",
        body: {
          source_url: "https://example.com/reference.png",
          media_type: "image",
        },
        headers: { "Idempotency-Key": "asset-request-1" },
      },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "presenter",
            input: {
              type: "prompt",
              prompt: "Hello",
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "presenter",
          input: {
            type: "prompt",
            prompt: "Hello",
          },
        },
        headers: { "Idempotency-Key": "request-1" },
      },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "presenter_two",
            input: {
              type: "prompt",
              prompt: "Hello again",
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "presenter_two",
          input: {
            type: "prompt",
            prompt: "Hello again",
          },
        },
        headers: { "Idempotency-Key": "request-high-1" },
      },
      { path: "/jobs/job_123/status", query: undefined },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "prompt_presenter",
            input: {
              type: "prompt",
              prompt: "A friendly presenter",
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "prompt_presenter",
          input: {
            type: "prompt",
            prompt: "A friendly presenter",
          },
        },
        headers: { "Idempotency-Key": "request-prompt-1" },
      },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "profile_presenter",
            input: {
              type: "props",
              ethnicity: "Asian",
              sex: "female",
              age: 32,
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "profile_presenter",
          input: {
            type: "props",
            ethnicity: "Asian",
            sex: "female",
            age: 32,
          },
        },
        headers: { "Idempotency-Key": "request-props-1" },
      },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "photo_presenter",
            input: {
              type: "photo",
              image_url:
                "https://media.sume.com/artifacts/mcp-avatar-photo-dry-run/reference.png",
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/avatars",
        query: { handle: "@studio_presenter", limit: 20, status: "ready" },
      },
      { path: "/avatars/avatar_123", query: undefined },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar-video/v1.0",
          request: {
            script: "Hello",
            product_image: "https://example.com/product.png",
            avatar_handle: "avatar_123",
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar-video/v1.0/runs",
        body: {
          script: "Hello",
          product_image: "https://example.com/product.png",
          avatar_handle: "avatar_123",
        },
        headers: { "Idempotency-Key": "video-request-1" },
      },
      { path: "/avatar-videos", query: undefined },
      { path: "/avatar-videos/avatar_video_123", query: undefined },
    ]);
  });

  it("requires local paid MCP calls to preview spend before submission", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 85_525 },
            },
          };
        }
        return { data: { status: "queued" } };
      },
    } as unknown as SumeApiClient;
    const avatarCreate = mcpTools.find(
      (candidate) => candidate.name === "avatars.create",
    );

    await expect(
      avatarCreate?.execute(
        {
          max_spend_usd: 1,
          payload: { avatar: { type: "prompt", prompt: "Hello" } },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "missing_mcp_tool_argument",
      message: "avatars.create requires idempotency_key.",
    });
    await expect(
      avatarCreate?.execute(
        {
          idempotency_key: "request-1",
          payload: { avatar: { type: "prompt", prompt: "Hello" } },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "missing_mcp_tool_argument",
      message: "avatars.create requires max_spend_usd.",
    });
    expect(calls).toEqual([]);

    await expect(
      avatarCreate?.execute(
        {
          idempotency_key: "request-1",
          max_spend_usd: 0.01,
          payload: { avatar: { type: "prompt", prompt: "Hello" } },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "max_spend_exceeded",
      message: "Estimated Sume usage exceeds max_spend_usd.",
    });
    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: { avatar: { type: "prompt", prompt: "Hello" } },
        },
        headers: undefined,
      },
    ]);

    calls.length = 0;
    const dryRun = await avatarCreate?.execute(
      {
        dry_run: true,
        idempotency_key: "request-2",
        max_spend_usd: 1,
        payload: { avatar: { type: "prompt", prompt: "Hello" } },
      },
      client,
    );
    expect(dryRun).toMatchObject({
      object: "mcp_paid_generation_dry_run",
      tool: "avatars.create",
      would_submit: false,
      avatar_summary: {
        object: "avatar_generation_summary",
        usage: {
          estimated_usd: 0.085525,
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/generation/admission-preview");

    calls.length = 0;
    const submitted = await avatarCreate?.execute(
      {
        idempotency_key: "request-3",
        max_spend_usd: 1,
        payload: {
          avatar_handle: "presenter",
          input: { type: "prompt", prompt: "Hello" },
        },
      },
      client,
    );
    expect(submitted).toMatchObject({
      data: { status: "queued" },
      avatar_summary: {
        object: "avatar_generation_summary",
        status: "queued",
      },
    });
    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "presenter",
            input: { type: "prompt", prompt: "Hello" },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "presenter",
          input: { type: "prompt", prompt: "Hello" },
        },
        headers: { "Idempotency-Key": "request-3" },
      },
    ]);
  });

  it("rejects avatar-video MCP scripts outside the local duration limit", async () => {
    const calls: Array<{ body?: unknown; path: string }> = [];
    const client = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return { data: { ok: true } };
      },
    } as unknown as SumeApiClient;
    const createAvatarVideo = mcpTools.find(
      (candidate) => candidate.name === "avatar-videos.create",
    );

    await expect(
      createAvatarVideo?.execute(
        {
          idempotency_key: "video-request-1",
          max_spend_usd: 1,
          payload: {
            script: words(169),
            product_image: "https://example.com/product.png",
            avatar_handle: "avatar_123",
          },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("maximum is 60 seconds"),
    });
    expect(calls).toEqual([]);
  });

  it("creates avatar-video MCP dry-runs from friendly handle and scene prompt fields", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        return {
          data: {
            admission: { would_accept: true },
            usage: { billable_amount_usd_micros: 125_000 },
          },
        };
      },
    } as unknown as SumeApiClient;
    const createAvatarVideo = mcpTools.find(
      (candidate) => candidate.name === "avatar-videos.create",
    );

    const result = await createAvatarVideo?.execute(
      {
        avatar_handle: "@david_im",
        dry_run: true,
        idempotency_key: "video-friendly-1",
        max_spend_usd: 1,
        mode: "async",
        resolution: "720p",
        scene_prompt: "Clean studio",
        script: "Say hello.",
        title: "Friendly video",
      },
      client,
    );

    expect(result).toMatchObject({
      model: "sume/avatar-video/v1.0",
      tool: "avatar-videos.create",
      would_submit: false,
    });
    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar-video/v1.0",
          request: {
            avatar_handle: "@david_im",
            mode: "async",
            quality: "plus",
            resolution: "720p",
            scene: { type: "prompt", prompt: "Clean studio" },
            script: "Say hello.",
            title: "Friendly video",
          },
        },
        headers: undefined,
      },
    ]);
  });

  it("creates avatar-video MCP submissions from friendly handle and scene image fields", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 125_000 },
            },
          };
        }
        return { data: { status: "queued" } };
      },
    } as unknown as SumeApiClient;
    const createAvatarVideo = mcpTools.find(
      (candidate) => candidate.name === "avatar-videos.create",
    );

    await createAvatarVideo?.execute(
      {
        avatar_handle: "avatar_123",
        idempotency_key: "video-friendly-2",
        max_spend_usd: 1,
        product_image: "https://media.sume.com/product.png",
        scene_image_url: "https://media.sume.com/scene.png",
        script: "Say hello.",
        wait_timeout_seconds: 10,
      },
      client,
    );

    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar-video/v1.0",
          request: {
            avatar_handle: "avatar_123",
            product_image: "https://media.sume.com/product.png",
            quality: "plus",
            scene: {
              type: "photo",
              image_url: "https://media.sume.com/scene.png",
            },
            script: "Say hello.",
            wait_timeout_seconds: 10,
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar-video/v1.0/runs",
        body: {
          avatar_handle: "avatar_123",
          product_image: "https://media.sume.com/product.png",
          quality: "plus",
          scene: {
            type: "photo",
            image_url: "https://media.sume.com/scene.png",
          },
          script: "Say hello.",
          wait_timeout_seconds: 10,
        },
        headers: { "Idempotency-Key": "video-friendly-2" },
      },
    ]);
  });

  it("submits exact launch-shaped avatar-video MCP payloads", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 125_000 },
            },
          };
        }
        return { data: { status: "queued" } };
      },
    } as unknown as SumeApiClient;
    const createAvatarVideo = mcpTools.find(
      (candidate) => candidate.name === "avatar-videos.create",
    );

    await createAvatarVideo?.execute(
      {
        idempotency_key: "video-exact-1",
        max_spend_usd: 1,
        payload: {
          avatar_handle: "@david_im",
          product_image: "https://media.sume.com/product.png",
          quality: "standard",
          scene: { type: "prompt", prompt: "Clean studio" },
          script: "Say hello.",
        },
      },
      client,
    );

    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar-video/v1.0",
          request: {
            avatar_handle: "@david_im",
            product_image: "https://media.sume.com/product.png",
            quality: "standard",
            scene: { type: "prompt", prompt: "Clean studio" },
            script: "Say hello.",
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar-video/v1.0/runs",
        body: {
          avatar_handle: "@david_im",
          product_image: "https://media.sume.com/product.png",
          quality: "standard",
          scene: { type: "prompt", prompt: "Clean studio" },
          script: "Say hello.",
        },
        headers: { "Idempotency-Key": "video-exact-1" },
      },
    ]);
  });

  it("normalizes common avatar-video aliases inside exact MCP payloads", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 125_000 },
            },
          };
        }
        return { data: { status: "queued" } };
      },
    } as unknown as SumeApiClient;
    const createAvatarVideo = mcpTools.find(
      (candidate) => candidate.name === "avatar-videos.create",
    );

    await createAvatarVideo?.execute(
      {
        idempotency_key: "video-exact-alias-1",
        max_spend_usd: 1,
        payload: {
          avatar_handle: "@david_im",
          product_image: "https://media.sume.com/product.png",
          scene_prompt: "Clean studio",
          script: "Say hello.",
        },
      },
      client,
    );

    expect(calls[0]).toMatchObject({
      body: {
        request: {
          avatar_handle: "@david_im",
          product_image: "https://media.sume.com/product.png",
          scene: { type: "prompt", prompt: "Clean studio" },
          script: "Say hello.",
        },
      },
    });
    expect(calls[1]).toMatchObject({
      body: {
        avatar_handle: "@david_im",
        product_image: "https://media.sume.com/product.png",
        scene: { type: "prompt", prompt: "Clean studio" },
        script: "Say hello.",
      },
    });
  });

  it("rejects ambiguous avatar-video MCP input before API calls", async () => {
    const calls: Array<{ body?: unknown; path: string }> = [];
    const client = {
      post: async (path: string, body: unknown) => {
        calls.push({ path, body });
        return { data: { ok: true } };
      },
    } as unknown as SumeApiClient;
    const createAvatarVideo = mcpTools.find(
      (candidate) => candidate.name === "avatar-videos.create",
    );

    await expect(
      createAvatarVideo?.execute(
        {
          avatar_handle: "@david_im",
          idempotency_key: "video-mixed-1",
          max_spend_usd: 1,
          payload: {
            script: "Say hello.",
            product_image: "https://media.sume.com/product.png",
            avatar: { mode: "existing", avatar_id: "avatar_123" },
          },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("Use either payload or friendly"),
    });

    await expect(
      createAvatarVideo?.execute(
        {
          avatar_handle: "@david_im",
          avatar_id: "avatar_123",
          idempotency_key: "video-avatar-refs-1",
          max_spend_usd: 1,
          product_image: "https://media.sume.com/product.png",
          script: "Say hello.",
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("avatar_id is not part of the launch"),
    });

    await expect(
      createAvatarVideo?.execute(
        {
          avatar_handle: "@david_im",
          idempotency_key: "video-scenes-1",
          max_spend_usd: 1,
          product_image: "https://media.sume.com/product.png",
          scene_image_url: "https://media.sume.com/scene.png",
          scene_prompt: "Clean studio",
          script: "Say hello.",
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: "Use either scene_prompt or scene_image_url, not both.",
    });

    await expect(
      createAvatarVideo?.execute(
        {
          background: "Old background alias",
          idempotency_key: "video-background-1",
          max_spend_usd: 1,
          payload: {
            script: "Say hello.",
            product_image: "https://media.sume.com/product.png",
            avatar_handle: "avatar_123",
          },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("background is not supported"),
    });

    await expect(
      createAvatarVideo?.execute(
        {
          idempotency_key: "video-callback-1",
          max_spend_usd: 1,
          payload: {
            avatar_handle: "studio_presenter",
            callback_url: "https://example.com/webhook",
            script: "Say hello.",
          },
        },
        client,
      ),
    ).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining(
        "callback_url is not part of the launch Avatar Video model-run request",
      ),
    });
    expect(calls).toEqual([]);
  });

  it("creates typed avatar requests without requiring raw payload shapes", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 125_000 },
            },
          };
        }
        return {
          data: {
            job: { id: "job_avatar" },
            avatar: { id: "avtr_created", handle: "typed_avatar" },
            status: "queued",
          },
        };
      },
    } as unknown as SumeApiClient;

    const promptResult = await mcpTools
      .find((candidate) => candidate.name === "avatars.create_prompt")
      ?.execute(
        {
          avatar_handle: "typed_avatar",
          idempotency_key: "prompt-1",
          max_spend_usd: 1,
          prompt: "A product presenter",
        },
        client,
      );
    const propsResult = await mcpTools
      .find((candidate) => candidate.name === "avatars.create_props")
      ?.execute(
        {
          age: 32,
          avatar_handle: "props_avatar",
          ethnicity: "Asian",
          idempotency_key: "props-1",
          max_spend_usd: 1,
          sex: "female",
        },
        client,
      );

    expect(promptResult).toMatchObject({
      avatar_summary: {
        avatar_id: "avtr_created",
        handle: "typed_avatar",
        job_id: "job_avatar",
        status: "queued",
        usage: { estimated_usd: null },
      },
    });
    expect(propsResult).toMatchObject({
      avatar_summary: {
        avatar_id: "avtr_created",
        job_id: "job_avatar",
      },
    });
    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "typed_avatar",
            input: {
              type: "prompt",
              prompt: "A product presenter",
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "typed_avatar",
          input: {
            type: "prompt",
            prompt: "A product presenter",
          },
        },
        headers: { "Idempotency-Key": "prompt-1" },
      },
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "props_avatar",
            input: {
              type: "props",
              ethnicity: "Asian",
              sex: "female",
              age: 32,
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "props_avatar",
          input: {
            type: "props",
            ethnicity: "Asian",
            sex: "female",
            age: 32,
          },
        },
        headers: { "Idempotency-Key": "props-1" },
      },
    ]);
  });

  it("creates photo avatar MCP requests from public image URLs", async () => {
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path?: string;
    }> = [];
    const client = {
      post: async (
        path: string,
        body: unknown,
        options?: { headers?: unknown },
      ) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/generation/admission-preview") {
          return {
            data: {
              admission: { would_accept: true },
              usage: { billable_amount_usd_micros: 200_000 },
            },
          };
        }
        if (path === "/models/sume/avatar/v1.0/runs") {
          return {
            data: {
              job: { id: "job_photo" },
              status: "queued",
            },
          };
        }
      },
    } as unknown as SumeApiClient;

    const result = await mcpTools
      .find((candidate) => candidate.name === "avatars.create_photo_url")
      ?.execute(
        {
          avatar_handle: "photo_avatar",
          idempotency_key: "photo-1",
          image_url: "https://media.sume.com/artifacts/reference.png",
          max_spend_usd: 1,
        },
        client,
      );
    const response = formatMcpToolResponse("avatars.create_photo_url", result);
    const serialized = response.content[0].text;

    expect(calls).toEqual([
      {
        path: "/generation/admission-preview",
        body: {
          model: "sume/avatar/v1.0",
          request: {
            avatar_handle: "photo_avatar",
            input: {
              type: "photo",
              image_url: "https://media.sume.com/artifacts/reference.png",
            },
          },
        },
        headers: undefined,
      },
      {
        path: "/models/sume/avatar/v1.0/runs",
        body: {
          avatar_handle: "photo_avatar",
          input: {
            type: "photo",
            image_url: "https://media.sume.com/artifacts/reference.png",
          },
        },
        headers: { "Idempotency-Key": "photo-1" },
      },
    ]);
    expect(result).toMatchObject({
      avatar_summary: {
        job_id: "job_photo",
        status: "queued",
      },
    });
    expect(serialized).not.toContain("token=");
    expect(serialized).not.toContain("signed-upload");
  });

  it("waits for a job terminal status without live generation calls", async () => {
    const statuses = ["processing", "completed"];
    const client = {
      get: async (path: string) => ({
        path,
        data: { status: statuses.shift() ?? "completed" },
        status_url: "https://api.sume.com/jobs/job_123/status",
      }),
    } as unknown as SumeApiClient;

    const result = await mcpTools
      .find((candidate) => candidate.name === "jobs.wait")
      ?.execute({ job_id: "job_123", interval_seconds: 1, timeout_seconds: 2 }, client);
    const response = formatMcpToolResponse("jobs.wait", result);
    const serialized = response.content[0].text;

    expect(result).toMatchObject({
      object: "job_wait",
      job_id: "job_123",
      status: "completed",
      terminal: true,
      timed_out: false,
      poll_count: 2,
    });
    expect(serialized).not.toContain("https://api.sume.com/jobs/job_123/status");
  });

  it("summarizes avatar job results with grouped public artifacts", async () => {
    const client = {
      get: async (path: string) => ({
        path,
        data: {
          job: { id: "job_123", status: "completed" },
          avatar: { id: "avtr_123", handle: "agent_avatar" },
          usage: {
            captured_amount_usd_micros: 900_000,
            usage_status: "captured",
          },
          artifacts: [
            {
              kind: "avatar-base",
              content_type: "image/png",
              url: "https://media.sume.com/artifacts/avatar-base.png",
            },
            {
              kind: "idle-video",
              content_type: "video/mp4",
              url: "https://media.sume.com/artifacts/idle-video.mp4",
            },
            {
              kind: "private-debug",
              content_type: "application/json",
              url: "https://storage.example/private.json?token=secret",
            },
          ],
        },
      }),
    } as unknown as SumeApiClient;

    const result = await mcpTools
      .find((candidate) => candidate.name === "jobs.result")
      ?.execute({ job_id: "job_123" }, client);
    const response = formatMcpToolResponse("jobs.result", result);
    const body = JSON.parse(response.content[0].text);

    expect(body.avatar_summary).toMatchObject({
      avatar_id: "avtr_123",
      handle: "agent_avatar",
      job_id: "job_123",
      status: "completed",
      usage: {
        captured_usd: 0.9,
        state: "captured",
      },
      artifacts: [
        {
          kind: "avatar_base",
          content_type: "image/png",
          public_url: "https://media.sume.com/artifacts/avatar-base.png",
        },
        {
          kind: "idle_video",
          content_type: "video/mp4",
          public_url: "https://media.sume.com/artifacts/idle-video.mp4",
        },
        {
          kind: "private_debug",
          content_type: "application/json",
          public_url: null,
        },
      ],
    });
    expect(response.content[0].text).not.toContain("https://storage.example");
    expect(response.content[0].text).toContain(
      "https://media.sume.com/artifacts/avatar-base.png",
    );
  });

  it("waits for avatar jobs and includes result summaries", async () => {
    const calls: string[] = [];
    const statuses = ["processing", "completed"];
    const client = {
      get: async (path: string) => {
        calls.push(path);
        if (path.endsWith("/status")) {
          return { data: { status: statuses.shift() ?? "completed" } };
        }
        return {
          data: {
            job: { id: "job_123", status: "completed" },
            avatar: { id: "avtr_waited", handle: "waited_avatar" },
            artifacts: [
              {
                kind: "idle-loop",
                content_type: "video/mp4",
                url: "https://media.sume.com/artifacts/idle-loop.mp4",
              },
            ],
          },
        };
      },
    } as unknown as SumeApiClient;

    const result = await mcpTools
      .find((candidate) => candidate.name === "avatars.wait")
      ?.execute({ job_id: "job_123", interval_seconds: 1, timeout_seconds: 2 }, client);

    expect(calls).toEqual([
      "/jobs/job_123/status",
      "/jobs/job_123/status",
      "/jobs/job_123/result",
    ]);
    expect(result).toMatchObject({
      object: "avatar_wait",
      job_id: "job_123",
      status: "completed",
      terminal: true,
      avatar_summary: {
        avatar_id: "avtr_waited",
        handle: "waited_avatar",
        artifacts: [
          {
            kind: "idle_loop",
            public_url: "https://media.sume.com/artifacts/idle-loop.mp4",
          },
        ],
      },
    });
  });

  it("uploads a local asset file without returning signed upload internals", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "sume-mcp-asset-upload-"));
    const filePath = join(tempDir, "reference.png");
    await writeFile(filePath, "fake-image-bytes");
    const calls: Array<{
      body?: unknown;
      headers?: unknown;
      path?: string;
      url?: string;
    }> = [];
    const client = {
      post: async (path: string, body: unknown, options?: { headers?: unknown }) => {
        calls.push({ path, body, headers: options?.headers });
        if (path === "/assets/upload-url") {
          return {
            data: {
              asset: { id: "asset_upload", status: "pending_upload" },
              upload: {
                asset_id: "asset_upload",
                url: "https://storage.example/signed-upload",
                headers: { "Content-Type": "image/png" },
              },
            },
          };
        }
        return {
          data: {
            asset: {
              id: "asset_upload",
              status: "ready",
              url: "https://api.sume.com/private/assets/asset_upload.png",
            },
          },
        };
      },
      uploadToSignedUrl: async (request: {
        body: Uint8Array;
        headers?: Record<string, string>;
        url: string;
      }) => {
        calls.push({ url: request.url, headers: request.headers });
        expect(new TextDecoder().decode(request.body)).toBe("fake-image-bytes");
        return { ok: true, status: 200 };
      },
    } as unknown as SumeApiClient;

    try {
      const result = await mcpTools
        .find((candidate) => candidate.name === "assets.upload_file")
        ?.execute(
          {
            content_type: "image/png",
            idempotency_key: "upload-1",
            media_type: "image",
            path: filePath,
          },
          client,
        );
      const response = formatMcpToolResponse("assets.upload_file", result);
      const serialized = response.content[0].text;

      expect(calls).toEqual([
        {
          path: "/assets/upload-url",
          body: {
            content_type: "image/png",
            filename: "reference.png",
            media_type: "image",
            size_bytes: 16,
          },
          headers: { "Idempotency-Key": "upload-1" },
        },
        {
          url: "https://storage.example/signed-upload",
          headers: { "Content-Type": "image/png" },
        },
        {
          path: "/assets/asset_upload/complete",
          body: { size_bytes: 16 },
          headers: { "Idempotency-Key": "upload-1" },
        },
      ]);
      expect(result).toMatchObject({
        object: "asset_file_upload",
        asset_id: "asset_upload",
        file: {
          filename: "reference.png",
          content_type: "image/png",
          media_type: "image",
          size_bytes: 16,
        },
      });
      expect(serialized).not.toContain("https://storage.example/signed-upload");
      expect(serialized).not.toContain(filePath);
      expect(serialized).not.toContain("https://api.sume.com/private");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("MCP install dry-run registry", () => {
  it("generates read-only config snippets for supported clients", () => {
    expect(supportedMcpClientAgents()).toEqual(["codex", "claude-code", "cursor"]);

    for (const agent of supportedMcpClientAgents()) {
      const result = buildMcpInstallDryRun(agent, { homeDir: "/tmp/sume-home" });
      expect(result).toMatchObject({
        object: "mcp_install_dry_run",
        agent,
        command: ["sume", "mcp"],
        dry_run: true,
        writes_config: false,
        safety: {
          read_only_default: true,
          write_tools_enabled: false,
          paid_tools_enabled: false,
        },
      });
      expect(result.snippet).toContain("sume");
      expect(result.snippet).toContain("mcp");
      expect(result.snippet).not.toContain("allow-write");
      expect(result.snippet).not.toContain("allow-paid");
    }
  });

  it("uses client-specific config formats and locations", () => {
    expect(buildMcpInstallDryRun("codex", { homeDir: "/tmp/sume-home" })).toMatchObject({
      config_location: "~/.codex/config.toml",
      config_path: "/tmp/sume-home/.codex/config.toml",
      format: "toml",
      snippet: `[mcp_servers.sume]\ncommand = "sume"\nargs = ["mcp"]\n`,
    });
    expect(
      buildMcpInstallDryRun("claude-code", { homeDir: "/tmp/sume-home" }),
    ).toMatchObject({
      config_location: "~/.claude.json",
      config_path: "/tmp/sume-home/.claude.json",
      format: "json",
    });
    expect(buildMcpInstallDryRun("cursor", { homeDir: "/tmp/sume-home" })).toMatchObject({
      config_location: "~/.cursor/mcp.json",
      config_path: "/tmp/sume-home/.cursor/mcp.json",
      format: "json",
    });
  });

  it("rejects unsupported clients", () => {
    expect(() => buildMcpInstallDryRun("unsupported")).toThrow(
      "Unsupported MCP agent: unsupported",
    );
  });

  it("creates missing client config files with read-only Sume MCP entries", async () => {
    for (const agent of supportedMcpClientAgents()) {
      const homeDir = await mkdtemp(join(tmpdir(), `sume-mcp-install-${agent}-`));
      try {
        const result = installMcpClientConfig(agent, { homeDir });
        expect(result).toMatchObject({
          object: "mcp_install",
          agent,
          command: ["sume", "mcp"],
          dry_run: false,
          status: "configured",
          writes_config: true,
          safety: {
            read_only_default: true,
            write_tools_enabled: false,
            paid_tools_enabled: false,
          },
        });

        const written = await readFile(result.config_path, "utf8");
        expect(written).toContain("sume");
        expect(written).toContain("mcp");
        expect(written).not.toContain("allow-write");
        expect(written).not.toContain("allow-paid");
        expect(written).not.toContain("SUME_API_KEY");
      } finally {
        await rm(homeDir, { recursive: true, force: true });
      }
    }
  });

  it("preserves unrelated JSON config and updates the existing Sume entry", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sume-mcp-install-json-"));
    try {
      const configPath = join(homeDir, ".cursor", "mcp.json");
      await mkdir(join(homeDir, ".cursor"), { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            editor: { theme: "dark" },
            mcpServers: {
              other: { command: "other", args: ["mcp"] },
              sume: { command: "old-sume", args: ["mcp", "--allow-paid"] },
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = installMcpClientConfig("cursor", { homeDir });
      const firstWrite = await readFile(result.config_path, "utf8");
      installMcpClientConfig("cursor", { homeDir });
      const secondWrite = await readFile(result.config_path, "utf8");
      const parsed = JSON.parse(secondWrite);

      expect(firstWrite).toBe(secondWrite);
      expect(parsed).toMatchObject({
        editor: { theme: "dark" },
        mcpServers: {
          other: { command: "other", args: ["mcp"] },
          sume: { command: "sume", args: ["mcp"] },
        },
      });
      expect(secondWrite).not.toContain("allow-paid");
      expect(secondWrite).not.toContain("allow-write");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("preserves unrelated Codex TOML and removes stale Sume MCP details", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sume-mcp-install-toml-"));
    try {
      const configPath = join(homeDir, ".codex", "config.toml");
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(
        configPath,
        [
          'model = "gpt-5"',
          "",
          "[mcp_servers.other]",
          'command = "other"',
          'args = ["mcp"]',
          "",
          "[mcp_servers.sume]",
          'command = "old-sume"',
          'args = ["mcp", "--allow-write"]',
          "",
          "[mcp_servers.sume.env]",
          'SUME_API_KEY = "secret"',
          "",
          "[[profiles]]",
          'name = "default"',
          "",
        ].join("\n"),
      );

      const result = installMcpClientConfig("codex", { homeDir });
      const firstWrite = await readFile(result.config_path, "utf8");
      installMcpClientConfig("codex", { homeDir });
      const secondWrite = await readFile(result.config_path, "utf8");

      expect(firstWrite).toBe(secondWrite);
      expect(secondWrite).toContain('model = "gpt-5"');
      expect(secondWrite).toContain("[mcp_servers.other]");
      expect(secondWrite).toContain("[[profiles]]");
      expect(secondWrite.match(/\[mcp_servers\.sume\]/gu) ?? []).toHaveLength(1);
      expect(secondWrite).toContain('command = "sume"');
      expect(secondWrite).toContain('args = ["mcp"]');
      expect(secondWrite).not.toContain("old-sume");
      expect(secondWrite).not.toContain("allow-write");
      expect(secondWrite).not.toContain("allow-paid");
      expect(secondWrite).not.toContain("SUME_API_KEY");
      expect(secondWrite).not.toContain("secret");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("fails closed on malformed existing configs without overwriting them", async () => {
    const jsonHome = await mkdtemp(join(tmpdir(), "sume-mcp-install-bad-json-"));
    const tomlHome = await mkdtemp(join(tmpdir(), "sume-mcp-install-bad-toml-"));
    try {
      const jsonPath = join(jsonHome, ".cursor", "mcp.json");
      await mkdir(join(jsonHome, ".cursor"), { recursive: true });
      await writeFile(jsonPath, "{not valid json");
      expect(() => installMcpClientConfig("cursor", { homeDir: jsonHome })).toThrow(
        "Existing MCP client config is not valid JSON.",
      );
      expect(await readFile(jsonPath, "utf8")).toBe("{not valid json");

      const tomlPath = join(tomlHome, ".codex", "config.toml");
      await mkdir(join(tomlHome, ".codex"), { recursive: true });
      await writeFile(tomlPath, "[mcp_servers.sume\ncommand = \"old\"\n");
      expect(() => installMcpClientConfig("codex", { homeDir: tomlHome })).toThrow(
        "Existing Codex MCP config has an unsupported TOML table header.",
      );
      expect(await readFile(tomlPath, "utf8")).toBe(
        "[mcp_servers.sume\ncommand = \"old\"\n",
      );
    } finally {
      await rm(jsonHome, { recursive: true, force: true });
      await rm(tomlHome, { recursive: true, force: true });
    }
  });

  it("reports MCP client readiness without requiring installed configs", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sume-mcp-doctor-empty-"));
    try {
      const report = buildMcpDoctorReport({ homeDir });
      expect(report).toMatchObject({
        object: "mcp_doctor_report",
        ok: true,
        schema_version: 1,
        summary: {
          total: 3,
          configured: 0,
          unconfigured: 3,
          misconfigured: 0,
        },
      });
      expect(report.clients.map((client) => client.status)).toEqual([
        "unconfigured",
        "unconfigured",
        "unconfigured",
      ]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports configured MCP clients after install", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sume-mcp-doctor-installed-"));
    try {
      installMcpClientConfig("cursor", { homeDir });
      const readiness = inspectMcpClientConfig("cursor", { homeDir });
      expect(readiness).toMatchObject({
        agent: "cursor",
        configured: true,
        expected_command: ["sume", "mcp"],
        status: "configured",
        safety: {
          read_only_default: true,
          write_tools_enabled: false,
          paid_tools_enabled: false,
        },
      });
      expect(readiness.issues).toEqual([]);
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports unsafe persisted MCP gates as misconfigured without echoing secrets", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sume-mcp-doctor-unsafe-"));
    try {
      const configPath = join(homeDir, ".cursor", "mcp.json");
      await mkdir(join(homeDir, ".cursor"), { recursive: true });
      await writeFile(
        configPath,
        `${JSON.stringify(
          {
            mcpServers: {
              sume: {
                command: "sume",
                args: ["mcp", "--allow-write", "--allow-paid"],
                env: { SUME_API_KEY: "secret-test-key" },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const readiness = inspectMcpClientConfig("cursor", { homeDir });
      expect(readiness).toMatchObject({
        status: "misconfigured",
        configured: false,
        safety: {
          write_tools_enabled: true,
          paid_tools_enabled: true,
        },
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "unsafe_write_gate" }),
          expect.objectContaining({ code: "unsafe_paid_gate" }),
        ]),
      });
      const serialized = JSON.stringify(readiness);
      expect(serialized).not.toContain("secret-test-key");
      expect(serialized).not.toContain("SUME_API_KEY");
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("reports malformed MCP client configs as local readiness issues", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "sume-mcp-doctor-malformed-"));
    try {
      const configPath = join(homeDir, ".codex", "config.toml");
      await mkdir(join(homeDir, ".codex"), { recursive: true });
      await writeFile(configPath, "[mcp_servers.sume\ncommand = \"sume\"\n");

      const report = buildMcpDoctorReport({ homeDir });
      expect(report).toMatchObject({
        ok: false,
        summary: {
          configured: 0,
          misconfigured: 1,
          unconfigured: 2,
        },
      });
      expect(report.clients.find((client) => client.agent === "codex")).toMatchObject({
        status: "misconfigured",
        issues: [expect.objectContaining({ code: "invalid_config" })],
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});

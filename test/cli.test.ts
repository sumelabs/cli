import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const tsx = "node_modules/.bin/tsx";
const execFileAsync = promisify(execFile);

type ApiRequest = {
  body: unknown;
  url: string;
  method?: string;
  headers: http.IncomingHttpHeaders;
};

async function withMockApi<T>(
  handler: (request: ApiRequest) => unknown,
  run: (baseUrl: string, requests: ApiRequest[]) => Promise<T>,
) {
  const requests: ApiRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body: unknown = null;
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = rawBody;
        }
      }
      const captured = {
        body,
        url: request.url ?? "",
        method: request.method,
        headers: request.headers,
      };
      requests.push(captured);
      const responseBody = handler(captured);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(responseBody));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock API server did not bind to a TCP port.");
  }

  try {
    return await run(`http://127.0.0.1:${address.port}/v1`, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function runCli(
  args: string[],
  baseUrl: string,
  extraEnv: Record<string, string> = {},
) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-cli-test-"));
  try {
    return await execFileAsync(tsx, ["src/index.ts", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SUME_API_AUTH_MODE: "x-api-key",
        SUME_API_BASE_URL: baseUrl,
        SUME_API_KEY: "test-key",
        SUME_CONFIG_DIR: tempDir,
        ...extraEnv,
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runCliFailure(
  args: string[],
  baseUrl: string,
  extraEnv: Record<string, string> = {},
) {
  try {
    await runCli(args, baseUrl, extraEnv);
  } catch (error) {
    return error as { stdout?: string; stderr?: string };
  }
  throw new Error("Expected CLI command to fail.");
}

function words(count: number) {
  return Array.from({ length: count }, (_value, index) => `word${index}`).join(
    " ",
  );
}

describe("CLI", () => {
  it("keeps JSON-mode commander errors on stderr without human help", async () => {
    for (const args of [
      ["--json", "not-a-command"],
      ["--json", "jobs", "get"],
      ["--json", "jobs", "list", "--bogus"],
    ]) {
      try {
        await execFileAsync(tsx, ["src/index.ts", ...args], {
          encoding: "utf8",
        });
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        expect(failure.stdout ?? "").toBe("");
        const parsed = JSON.parse(failure.stderr ?? "");
        expect(parsed).toMatchObject({
          error: {
            code: "invalid_argument",
            details: expect.objectContaining({
              commander_code: expect.stringMatching(/^commander\./u),
            }),
          },
        });
        expect(failure.stderr).not.toContain("Usage:");
        continue;
      }
      throw new Error(`Expected command to fail: ${args.join(" ")}`);
    }
  });

  it("does not silently succeed for parent command groups", async () => {
    const failure = await runCliFailure(["--json", "catalog"], "http://127.0.0.1/v1");
    expect(failure.stdout ?? "").toBe("");
    const parsed = JSON.parse(failure.stderr ?? "");
    expect(parsed).toMatchObject({
      error: {
        code: "missing_subcommand",
        message: "Missing subcommand for sume catalog.",
        details: { subcommands: ["list"] },
        hint: "Run sume catalog list.",
      },
    });

    const human = await execFileAsync(tsx, ["src/index.ts", "catalog"], {
      encoding: "utf8",
    });
    expect(human.stdout).toContain("Usage sume catalog");
    expect(human.stdout).toContain("list        List public API capabilities.");

    const batchFailure = await runCliFailure(
      ["--json", "avatars", "batch"],
      "http://127.0.0.1/v1",
    );
    expect(JSON.parse(batchFailure.stderr ?? "")).toMatchObject({
      error: {
        code: "missing_subcommand",
        message: "Missing subcommand for sume avatars batch.",
        hint: "Run sume avatars batch plan.",
      },
    });
  });

  it("prints root JSON metadata", async () => {
    const { stdout } = await execFileAsync(tsx, ["src/index.ts", "--json"], {
      encoding: "utf8",
    });
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("sume");
    expect(parsed.description).toContain("sume.com");
    expect(parsed.install).toMatchObject({
      hosted_installer: "curl https://cli.sume.com/install -fsS | bash",
      verifies_release_checksums: true,
    });
    expect(parsed.update).toMatchObject({
      check_command: "sume update --check",
      mutates_local_files: false,
    });
    expect(parsed.commands).toContain("assets");
    expect(parsed.commands).toContain("avatar-videos");
    expect(parsed.commands).toContain("avatars");
    expect(parsed.commands).toContain("balance");
    expect(parsed.commands).toContain("catalog");
    expect(parsed.commands).toContain("doctor");
    expect(parsed.commands).toContain("health");
    expect(parsed.commands).toContain("jobs");
    expect(parsed.commands).toContain("skills");
    expect(parsed.commands).toContain("tools");
    expect(parsed.commands).toContain("update");
    expect(parsed.commands).toContain("usage");
    expect(parsed.commands).not.toContain("mcp");
    expect(parsed.commands).not.toContain("setup");
    expect(parsed.commands).not.toContain("images");
    expect(parsed.commands).not.toContain("videos");
    expect(parsed.commands).not.toContain("files");
    expect(parsed.coming_soon).toContainEqual(
      expect.objectContaining({
        object: "mcp_status",
        status: "coming_soon",
        launched: false,
      }),
    );
  });

  it("prints help", async () => {
    const { stdout } = await execFileAsync(tsx, ["src/index.ts", "--help"], {
      encoding: "utf8",
    });
    expect(stdout).toContain("Agent-first CLI for sume.com");
    expect(stdout).toContain("assets");
    expect(stdout).toContain("avatar-videos");
    expect(stdout).toContain("avatars");
    expect(stdout).toContain("balance");
    expect(stdout).toContain("catalog");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("health");
    expect(stdout).toContain("skills");
    expect(stdout).toContain("tools");
    expect(stdout).toContain("update");
    expect(stdout).toContain("usage");
    expect(stdout).not.toContain("mcp");
    expect(stdout).not.toContain("setup");
    expect(stdout).not.toContain("images");
    expect(stdout).not.toMatch(/\n\s+videos\s/u);
    expect(stdout).not.toContain("files");

    const avatarVideoHelp = await execFileAsync(
      tsx,
      ["src/index.ts", "avatar-videos", "create", "--help"],
      {
        encoding: "utf8",
      },
    );
    expect(avatarVideoHelp.stdout).toContain("--scene-prompt");
    expect(avatarVideoHelp.stdout).toContain("--scene-image-url");
    expect(avatarVideoHelp.stdout).toContain("4-60 seconds");
    expect(avatarVideoHelp.stdout).not.toContain("--background");
  });

  it("lists and exports bundled Sume agent skills", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl) => {
        const list = await runCli(["--json", "skills", "list"], baseUrl);
        const parsedList = JSON.parse(list.stdout);
        const names = parsedList.skills.map((skill: { name: string }) => skill.name);
        expect(names).toEqual(
          expect.arrayContaining([
            "sume",
            "sume-assets",
            "sume-avatar",
            "sume-avatar-video",
            "sume-tools",
          ]),
        );

        const exported = await runCli(
          ["--json", "skills", "export", "sume-avatar-video"],
          baseUrl,
        );
        const parsedExport = JSON.parse(exported.stdout);
        expect(parsedExport.skill.name).toBe("sume-avatar-video");
        expect(Object.keys(parsedExport.files)).toEqual(
          expect.arrayContaining([
            "SKILL.md",
            "references/avatar-video-batch-manifest.md",
          ]),
        );
        const body = JSON.stringify(parsedExport);
        expect(body).toContain("api.sume.com");
        expect(body).toContain("Avatar Video 1.0");
        expect(body).toContain("Not For");
        expect(body).toContain("Face Swap");
        expect(body).toContain("unless they are added to the current public");
      },
    );
  });

  it("checks latest CLI release without mutating local files", async () => {
    await withMockApi(
      (request) => {
        expect(request.url).toBe("/latest");
        return {
          object: "sume_cli_release",
          version: "0.1.0",
          tag: "v0.1.0",
          url: "https://github.com/sumelabs/cli/releases/download/v0.1.0/manifest.json",
        };
      },
      async (baseUrl) => {
        const latestUrl = baseUrl.replace(/\/v1$/u, "/latest");
        const { stdout } = await runCli(
          ["--json", "update", "--check", "--latest-url", latestUrl],
          baseUrl,
        );
        expect(JSON.parse(stdout)).toMatchObject({
          object: "update_check",
          current_version: "0.1.0",
          latest_version: "0.1.0",
          update_available: false,
          install_command: expect.stringContaining("cli.sume.com/install"),
          pinned_install_command: expect.stringContaining("SUME_VERSION=0.1.0"),
        });
        expect(stdout).not.toContain("test-key");
      },
    );
  });

  it("logs in with the browser device flow and stores the returned API key", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/api/cli/auth/device/start") {
          expect(request.body).toMatchObject({ device_label: "CI" });
          return {
            object: "cli_login_request",
            device_code: "device_secret",
            user_code: "ABCD-2345",
            verification_uri: "http://127.0.0.1/cli/login",
            verification_uri_complete:
              "http://127.0.0.1/cli/login?user_code=ABCD-2345",
            expires_in: 2,
            interval: 1,
            scopes: ["public_api"],
          };
        }
        if (request.url === "/api/cli/auth/device/poll") {
          expect(request.body).toEqual({ device_code: "device_secret" });
          return {
            object: "cli_login_exchange",
            status: "approved",
            api_key: {
              id: "key_1",
              key: "test_cli_key_1234567890",
              key_prefix: "sume_live_secret",
              scopes: ["public_api"],
            },
          };
        }
        throw new Error(`Unexpected login request: ${request.url}`);
      },
      async (baseUrl, requests) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-login-"));
        try {
          const { stdout, stderr } = await execFileAsync(
            tsx,
            [
              "src/index.ts",
              "--json",
              "login",
              "--no-browser",
              "--timeout",
              "2",
              "--device-label",
              "CI",
            ],
            {
              encoding: "utf8",
              env: {
                ...process.env,
                SUME_API_BASE_URL: baseUrl,
                SUME_CONFIG_DIR: tempDir,
              },
            },
          );

          const parsed = JSON.parse(stdout);
          expect(parsed).toMatchObject({
            object: "login",
            status: "authenticated",
            api_key: {
              id: "key_1",
              key: "test_c...7890",
            },
          });
          expect(stdout).not.toContain("test_cli_key_1234567890");
          expect(stderr).toBe("");
          expect(requests.map((request) => request.url)).toEqual([
            "/api/cli/auth/device/start",
            "/api/cli/auth/device/poll",
          ]);

          const config = JSON.parse(
            fs.readFileSync(path.join(tempDir, "config.json"), "utf8"),
          );
          expect(config).toMatchObject({
            apiKey: "test_cli_key_1234567890",
            authMode: "x-api-key",
            appBaseUrl: baseUrl.replace(/\/v1$/u, ""),
          });
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("checks unversioned and versioned API health", async () => {
    await withMockApi(
      (request) => ({
        path: request.url,
        status: "ok",
      }),
      async (baseUrl, requests) => {
        const service = await runCli(["--json", "health"], baseUrl);
        const versioned = await runCli(["--json", "health", "v1"], baseUrl);

        expect(JSON.parse(service.stdout)).toMatchObject({
          path: "/health",
          status: "ok",
        });
        expect(JSON.parse(versioned.stdout)).toMatchObject({
          path: "/v1/health",
          status: "ok",
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/health",
          "/v1/health",
        ]);
      },
    );
  });

  it("prints agent doctor diagnostics without calling the API", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(["--json", "doctor", "--agent"], baseUrl);
        expect(JSON.parse(stdout)).toMatchObject({
          object: "doctor_report",
          mode: "agent",
          schema_version: 1,
          ok: true,
          auth: {
            configured: true,
            source: "environment",
          },
          safety: {
            mcp_status: "coming_soon",
            write_commands_require_confirmation: true,
            agent_job_outputs_redact_urls: true,
          },
          mcp: {
            object: "mcp_status",
            status: "coming_soon",
            launched: false,
          },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("reports MCP coming soon without writing client config", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-cli-mcp-install-"));
    try {
      const failure = await runCliFailure(
        ["mcp", "install", "--agent", "codex", "--dry-run", "--json"],
        "http://127.0.0.1/v1",
        { HOME: homeDir },
      );
      expect(JSON.parse(failure.stderr ?? "")).toMatchObject({
        error: {
          code: "mcp_not_launched",
          message:
            "Sume MCP client setup is coming soon and is not launched in this CLI release yet.",
          hint: expect.stringContaining("Use direct Sume CLI commands today"),
        },
      });
      expect(fs.existsSync(path.join(homeDir, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("reports MCP launch status without calling the API", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          ["--json", "mcp", "doctor"],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(parsed).toMatchObject({
          object: "mcp_status",
          status: "coming_soon",
          launched: false,
          recommended_surface: "direct_cli",
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("does not write setup agent config before MCP launch", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-cli-setup-agent-"));
    try {
      const failure = await runCliFailure(
        ["--json", "setup", "agent", "--agent", "codex"],
        "http://127.0.0.1/v1",
        { HOME: homeDir, SUME_API_KEY: "" },
      );
      expect(JSON.parse(failure.stderr ?? "")).toMatchObject({
        error: {
          code: "agent_setup_not_launched",
          message:
            "Sume agent setup is coming soon and is not launched in this CLI release yet.",
          hint: expect.stringContaining("No agent or MCP client config was written"),
        },
      });
      expect(fs.existsSync(path.join(homeDir, ".codex", "config.toml"))).toBe(
        false,
      );
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("reports MCP start as coming soon", async () => {
    const failure = await runCliFailure(["--json", "mcp"], "http://127.0.0.1/v1");
    expect(JSON.parse(failure.stderr ?? "")).toMatchObject({
      error: {
        code: "mcp_not_launched",
        message: "Sume MCP is coming soon and is not launched in this CLI release yet.",
        hint: expect.stringContaining("Use direct Sume CLI commands today"),
      },
    });
  });

  it("reports MCP install as coming soon before agent validation", async () => {
    for (const agent of ["claude-code", "cursor", "windsurf"]) {
      const failure = await runCliFailure(
        ["--json", "mcp", "install", "--agent", agent, "--dry-run"],
        "http://127.0.0.1/v1",
      );
      expect(JSON.parse(failure.stderr ?? "")).toMatchObject({
        error: {
          code: "mcp_not_launched",
          message:
            "Sume MCP client setup is coming soon and is not launched in this CLI release yet.",
        },
      });
    }
  });

  it("surfaces normalized production API base URL diagnostics", async () => {
    const doctor = await runCli(
      ["--json", "doctor", "--agent"],
      "https://api.sume.com",
    );
    const doctorJson = JSON.parse(doctor.stdout);
    expect(doctorJson.api).toMatchObject({
      base_url: "https://api.sume.com/v1",
      configured_base_url: "https://api.sume.com",
      warnings: [
        expect.objectContaining({
          code: "production_api_base_url_unversioned",
          resolved_base_url: "https://api.sume.com/v1",
        }),
      ],
    });

    const authStatus = await runCli(
      ["--json", "auth", "status"],
      "https://api.sume.com",
    );
    expect(JSON.parse(authStatus.stdout)).toMatchObject({
      base_url: "https://api.sume.com/v1",
      configured_base_url: "https://api.sume.com",
      warnings: [
        expect.objectContaining({
          code: "production_api_base_url_unversioned",
          suggestion: expect.stringContaining("https://api.sume.com/v1"),
        }),
      ],
    });
  });

  it("lists tool contracts and schemas for agents", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const list = await runCli(["--json", "tools", "list"], baseUrl);
        const parsedList = JSON.parse(list.stdout);
        expect(parsedList.tools.map((tool: { name: string }) => tool.name)).toContain(
          "assets.get",
        );
        expect(parsedList.tools.map((tool: { name: string }) => tool.name)).toContain(
          "assets.create",
        );
        expect(parsedList.tools.map((tool: { name: string }) => tool.name)).toContain(
          "jobs.result",
        );
        expect(parsedList.tools.map((tool: { name: string }) => tool.name)).toContain(
          "jobs.watch",
        );
        expect(parsedList.tools.map((tool: { name: string }) => tool.name)).toContain(
          "tools.schema",
        );
        expect(
          parsedList.tools.map((tool: { name: string }) => tool.name),
        ).not.toContain("jobs.wait");
        expect(
          parsedList.tools.map((tool: { name: string }) => tool.name),
        ).not.toContain("assets.upload_file");
        for (const name of [
          "assets.download",
          "avatar-videos.batch.plan",
          "avatars.batch.create",
          "balance.get",
          "jobs.download",
          "skills.list",
          "usage.get",
        ]) {
          expect(
            parsedList.tools.map((tool: { name: string }) => tool.name),
          ).toContain(name);
        }
        expect(parsedList.tools).toContainEqual(
          expect.objectContaining({
            name: "avatars.create",
            safety: expect.objectContaining({
              requires_confirmation: true,
              read_only: false,
            }),
          }),
        );
        const avatarCreateSchema = await runCli(
          ["--json", "tools", "schema", "avatars.create"],
          baseUrl,
        );
        expect(JSON.parse(avatarCreateSchema.stdout)).toMatchObject({
          name: "avatars.create",
          input_schema: {
            properties: {
              model: expect.objectContaining({
                enum: ["sume/avatar/v1.0"],
              }),
              avatar_handle: expect.objectContaining({ type: "string" }),
              handle: expect.objectContaining({ type: "string" }),
              image_url: expect.objectContaining({ type: "string" }),
            },
          },
          constraints: expect.arrayContaining([
            "type photo requires avatar_handle plus image_url.",
          ]),
        });

        const schema = await runCli(
          ["--json", "tools", "schema", "jobs.result"],
          baseUrl,
        );
        expect(JSON.parse(schema.stdout)).toMatchObject({
          object: "tool_schema",
          name: "jobs.result",
          command: "sume jobs result <job_id> --agent --json",
          input_schema: {
            type: "object",
            properties: {
              job_id: expect.objectContaining({ type: "string" }),
              agent: expect.objectContaining({ type: "boolean" }),
            },
            required: ["job_id"],
          },
          mcp_input_schema: null,
          execution: expect.objectContaining({
            mcp_tool: null,
          }),
          mcp: {
            status: "coming_soon",
            launched: false,
          },
          safety: { read_only: true },
        });
        const waitSchema = await runCliFailure(
          ["--json", "tools", "schema", "jobs.wait"],
          baseUrl,
        );
        expect(JSON.parse(waitSchema.stderr ?? "")).toMatchObject({
          error: { code: "tool_schema_not_found" },
        });
        const watchSchema = await runCli(
          ["--json", "tools", "schema", "jobs.watch"],
          baseUrl,
        );
        expect(JSON.parse(watchSchema.stdout)).toMatchObject({
          name: "jobs.watch",
          command: "sume jobs watch <job_id> --agent --json",
          input_schema: {
            properties: {
              ids: expect.objectContaining({ type: "array" }),
              timeout_seconds: expect.objectContaining({ default: 300 }),
            },
          },
          mcp_input_schema: null,
          safety: { read_only: true },
        });
        const skillSchema = await runCli(
          ["--json", "tools", "schema", "skills.list"],
          baseUrl,
        );
        expect(JSON.parse(skillSchema.stdout)).toMatchObject({
          name: "skills.list",
          command: "sume skills list --json",
          safety: { read_only: true },
        });
        const batchSchema = await runCli(
          ["--json", "tools", "schema", "avatar-videos.batch.create"],
          baseUrl,
        );
        expect(JSON.parse(batchSchema.stdout)).toMatchObject({
          name: "avatar-videos.batch.create",
          safety: {
            read_only: false,
            requires_confirmation: true,
            paid_generation_call: true,
          },
          confirmation: {
            required: true,
          },
        });
        const assetGetSchema = await runCli(
          ["--json", "tools", "schema", "assets.get"],
          baseUrl,
        );
        expect(JSON.parse(assetGetSchema.stdout)).toMatchObject({
          name: "assets.get",
          command: "sume assets get <asset_id> --agent --json",
          input_schema: {
            required: ["asset_id"],
            properties: {
              asset_id: expect.objectContaining({ type: "string" }),
              agent: expect.objectContaining({ type: "boolean" }),
            },
          },
          mcp_input_schema: null,
          mcp: {
            status: "coming_soon",
            launched: false,
          },
          safety: expect.objectContaining({
            read_only: true,
            requires_agent_redaction: true,
            returns_sensitive_url: true,
          }),
        });
        const assetCreateSchema = await runCli(
          ["--json", "tools", "schema", "assets.create"],
          baseUrl,
        );
        expect(JSON.parse(assetCreateSchema.stdout)).toMatchObject({
          name: "assets.create",
          command:
            "sume assets create --confirm-submit --source-url <PUBLIC_HTTPS_URL> --agent --json",
          confirmation: {
            accepted_flags: ["confirm_submit"],
            required: true,
          },
          input_schema: {
            required: ["source_url"],
            anyOf: expect.arrayContaining([
              expect.objectContaining({
                properties: { confirm_submit: { const: true } },
                required: ["confirm_submit"],
              }),
            ]),
            properties: {
              source_url: expect.objectContaining({
                format: "uri",
                type: "string",
              }),
              media_type: expect.objectContaining({
                enum: ["image", "video", "audio", "file"],
              }),
              confirm_submit: expect.objectContaining({ type: "boolean" }),
            },
          },
          mcp_input_schema: null,
          safety: expect.objectContaining({
            mutating: true,
            paid_generation_call: false,
            requires_confirmation: true,
            returns_sensitive_url: true,
          }),
        });
        const assetUploadFileSchema = await runCliFailure(
          ["--json", "tools", "schema", "assets.upload_file"],
          baseUrl,
        );
        expect(JSON.parse(assetUploadFileSchema.stderr ?? "")).toMatchObject({
          error: { code: "tool_schema_not_found" },
        });
        const jobCancelSchema = await runCli(
          ["--json", "tools", "schema", "jobs.cancel"],
          baseUrl,
        );
        expect(JSON.parse(jobCancelSchema.stdout)).toMatchObject({
          name: "jobs.cancel",
          safety: {
            mutating: true,
            paid_generation_call: false,
            read_only: false,
            requires_confirmation: true,
          },
        });
        const assetUploadUrlSchema = await runCli(
          ["--json", "tools", "schema", "assets.upload_url"],
          baseUrl,
        );
        expect(JSON.parse(assetUploadUrlSchema.stdout)).toMatchObject({
          name: "assets.upload_url",
          safety: {
            mutating: true,
            paid_generation_call: false,
            read_only: false,
            requires_confirmation: true,
          },
        });
        const assetCompleteSchema = await runCli(
          ["--json", "tools", "schema", "assets.complete"],
          baseUrl,
        );
        expect(JSON.parse(assetCompleteSchema.stdout)).toMatchObject({
          name: "assets.complete",
          safety: {
            mutating: true,
            paid_generation_call: false,
            read_only: false,
            requires_confirmation: true,
          },
        });
        const avatarSchema = await runCli(
          ["--json", "tools", "schema", "avatars.create"],
          baseUrl,
        );
        expect(JSON.parse(avatarSchema.stdout)).toMatchObject({
          name: "avatars.create",
          confirmation: {
            accepted_flags: ["confirm_submit", "confirm_paid"],
            required: true,
          },
          input_schema: {
            anyOf: expect.arrayContaining([
              expect.objectContaining({
                properties: { confirm_submit: { const: true } },
                required: ["confirm_submit"],
              }),
              expect.objectContaining({
                properties: { confirm_paid: { const: true } },
                required: ["confirm_paid"],
              }),
            ]),
            properties: {
              model: expect.objectContaining({
                enum: ["sume/avatar/v1.0"],
              }),
              avatar_handle: expect.objectContaining({ type: "string" }),
              handle: expect.objectContaining({ type: "string" }),
              image_url: expect.objectContaining({ type: "string" }),
              type: expect.objectContaining({
                enum: ["prompt", "photo", "props"],
              }),
              ethnicity: expect.objectContaining({
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
              }),
              age: expect.objectContaining({
                maximum: 80,
                minimum: 20,
                type: "integer",
              }),
              confirm_submit: expect.objectContaining({ type: "boolean" }),
            },
          },
          mcp_input_schema: null,
          safety: expect.objectContaining({
            requires_agent_redaction: true,
            returns_sensitive_url: true,
          }),
          execution: {
            generation_execution: "sume_api",
            generation_runtime: "sume_api",
          },
        });
        const avatarVideoSchema = await runCli(
          ["--json", "tools", "schema", "avatar-videos.create"],
          baseUrl,
        );
        const parsedAvatarVideoSchema = JSON.parse(avatarVideoSchema.stdout);
        expect(parsedAvatarVideoSchema).toMatchObject({
          name: "avatar-videos.create",
          confirmation: {
            accepted_flags: ["confirm_submit", "confirm_paid"],
            required: true,
          },
          input_schema: {
            required: ["script", "avatar_handle"],
            anyOf: expect.arrayContaining([
              expect.objectContaining({
                properties: { confirm_submit: { const: true } },
                required: ["confirm_submit"],
              }),
              expect.objectContaining({
                properties: { confirm_paid: { const: true } },
                required: ["confirm_paid"],
              }),
            ]),
            properties: {
              script: expect.objectContaining({ type: "string" }),
              avatar_handle: expect.objectContaining({ type: "string" }),
              product_image: expect.objectContaining({ type: "string" }),
              quality: expect.objectContaining({
                enum: ["standard", "plus", "max"],
                type: "string",
              }),
              mode: expect.objectContaining({
                enum: ["async", "sync", "subscribe", "webhook"],
              }),
            },
          },
          mcp_input_schema: null,
          execution: {
            generation_execution: "sume_api",
            generation_runtime: "sume_api",
            mcp_tool: null,
          },
          mcp: {
            status: "coming_soon",
            launched: false,
          },
        });
        expect(parsedAvatarVideoSchema.input_schema.required ?? []).not.toContain(
          "product_image",
        );
        expect(
          parsedAvatarVideoSchema.input_schema.properties.script.description,
        ).toContain("4-60 seconds");
        expect(parsedAvatarVideoSchema.constraints).toContain(
          "avatar_handle is required for flag-built requests.",
        );
        expect(
          parsedAvatarVideoSchema.input_schema.properties,
        ).not.toHaveProperty("background");
        const imageSchema = await runCliFailure(
          ["--json", "tools", "schema", "images.create"],
          baseUrl,
        );
        expect(JSON.parse(imageSchema.stderr ?? "")).toMatchObject({
          error: { code: "tool_schema_not_found" },
        });
        const videoSchema = await runCliFailure(
          ["--json", "tools", "schema", "videos.create"],
          baseUrl,
        );
        expect(JSON.parse(videoSchema.stderr ?? "")).toMatchObject({
          error: { code: "tool_schema_not_found" },
        });
        expect(requests).toHaveLength(0);
      },
    );
  }, 15000);

  it("calls /me with x-api-key auth for account get", async () => {
    await withMockApi(
      () => ({
        data: { account: { workspace_id: "workspace_123" } },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(["--json", "account", "get"], baseUrl);
        expect(JSON.parse(stdout)).toEqual({
          data: { account: { workspace_id: "workspace_123" } },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          method: "GET",
          url: "/v1/me",
        });
        expect(requests[0]?.headers["x-api-key"]).toBe("test-key");
        expect(requests[0]?.headers.authorization).toBeUndefined();
      },
    );
  });

  it("reads balance and usage ledger endpoints", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/balance") {
          return { data: { available_balance_usd_micros: 1230000 } };
        }
        if (request.url === "/v1/usage?cursor=next&limit=2") {
          return {
            data: {
              usage: [{ id: "usage_1", amount_usd_micros: 1000 }],
              next_cursor: null,
            },
          };
        }
        throw new Error(`Unexpected request: ${request.url}`);
      },
      async (baseUrl, requests) => {
        const balance = await runCli(["--json", "balance"], baseUrl);
        expect(JSON.parse(balance.stdout)).toMatchObject({
          data: { available_balance_usd_micros: 1230000 },
        });

        const usage = await runCli(
          ["--json", "usage", "get", "--limit", "2", "--cursor", "next"],
          baseUrl,
        );
        expect(JSON.parse(usage.stdout)).toMatchObject({
          data: { usage: [{ id: "usage_1" }] },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/balance",
          "/v1/usage?cursor=next&limit=2",
        ]);
      },
    );
  });

  it("calls job result endpoint with stable JSON output", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          status: "COMPLETED",
          result: { avatar_id: "avatar_123" },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          ["--json", "jobs", "result", "job_123"],
          baseUrl,
        );
        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            request_id: "job_123",
            status: "COMPLETED",
            result: { avatar_id: "avatar_123" },
          },
        });
        expect(requests[0]?.url).toBe("/v1/jobs/job_123/result");
      },
    );
  });

  it("redacts job result URLs in agent mode", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          status: "COMPLETED",
          result: {
            avatar_id: "avatar_123",
            media_url: "https://example.com/private-result.mp4",
            api_key: "sk-test-secret",
            apiKey: "sk-camel-secret",
            token: "token-secret",
            nested: {
              authorization: "Bearer private-token",
              client_secret: "client-secret",
            },
          },
          status_url: "https://api.sume.com/v1/jobs/job_123/status",
          workspace_id: "workspace_123",
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          ["--json", "jobs", "result", "job_123", "--agent"],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          data: {
            result: {
              media_url: "[redacted]",
              api_key: "[redacted]",
              apiKey: "[redacted]",
              token: "[redacted]",
              nested: {
                authorization: "[redacted]",
                client_secret: "[redacted]",
              },
            },
            status_url: "[redacted]",
            workspace_id: "[redacted]",
          },
          agent: {
            safe: true,
            redacted_count: 8,
          },
        });
        expect(requests[0]?.url).toBe("/v1/jobs/job_123/result");
      },
    );
  });

  it("summarizes job usage capture fields when the API exposes them", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          job_id: "job_123",
          status: "COMPLETED",
          sume_status: "completed",
          result_ready: true,
          next_action: "fetch_result",
          usage: {
            status: "captured",
            currency: "USD",
            provider_estimated_cost_usd_micros: 90_000,
            billable_amount_usd_micros: 90_000,
            captured_amount_usd_micros: 90_000,
          },
          job: {
            id: "job_123",
            type: "avatar_generation",
            status: "completed",
          },
        },
      }),
      async (baseUrl, requests) => {
        const human = await runCli(["jobs", "status", "job_123"], baseUrl);
        expect(human.stdout).toContain("Job status.");
        expect(human.stdout).toContain("Job ID");
        expect(human.stdout).toContain("job_123");
        expect(human.stdout).toContain("Usage");
        expect(human.stdout).toContain("state captured");
        expect(human.stdout).toContain("estimated USD $0.09");
        expect(human.stdout).toContain("captured USD $0.09");

        const agent = await runCli(
          ["--json", "jobs", "status", "job_123", "--agent"],
          baseUrl,
        );
        expect(JSON.parse(agent.stdout)).toMatchObject({
          agent: {
            safe: true,
            usage_summary: {
              available: true,
              state: "captured",
              captured_amount_usd_micros: 90_000,
            },
          },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/jobs/job_123/status",
          "/v1/jobs/job_123/status",
        ]);
      },
    );
  });

  it("states when final job usage is unavailable in public readback", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          status: "COMPLETED",
          result: { avatar_id: "avatar_123" },
        },
      }),
      async (baseUrl, requests) => {
        const human = await runCli(["jobs", "result", "job_123"], baseUrl);
        expect(human.stdout).toContain("Job result.");
        expect(human.stdout).toContain("Usage");
        expect(human.stdout).toContain("unavailable");
        expect(human.stdout).toContain(
          "API response does not include final usage ledger fields",
        );

        const agent = await runCli(
          ["--json", "jobs", "result", "job_123", "--agent"],
          baseUrl,
        );
        expect(JSON.parse(agent.stdout)).toMatchObject({
          agent: {
            safe: true,
            usage_summary: {
              available: false,
              state: "unavailable",
            },
          },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/jobs/job_123/result",
          "/v1/jobs/job_123/result",
        ]);
      },
    );
  });

  it("lists job events with agent-safe diagnostics", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          job_id: "job_123",
          events: [
            {
              type: "provider_failure",
              summary: "Provider returned a retryable error.",
              provider_task_id: "internal-task-123",
              provider_url: "https://provider.example/task/internal-task-123",
            },
          ],
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          ["--json", "jobs", "events", "job_123", "--limit", "25", "--agent"],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          data: {
            job_id: "job_123",
            events: [
              expect.objectContaining({
                type: "provider_failure",
                provider_url: "[redacted]",
              }),
            ],
          },
          agent: { safe: true },
        });
        expect(requests[0]?.url).toBe("/v1/jobs/job_123/events?limit=25");
      },
    );
  });

  it("cancels jobs only with explicit confirmation", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          job_id: "job_123",
          status: "CANCELED",
          canceled: true,
          status_url: "https://api.sume.com/v1/jobs/job_123/status",
          result_url: "https://api.sume.com/v1/jobs/job_123/result",
        },
      }),
      async (baseUrl, requests) => {
        const missingConfirmation = await runCliFailure(
          ["--json", "jobs", "cancel", "job_123"],
          baseUrl,
        );
        expect(JSON.parse(missingConfirmation.stderr ?? "")).toMatchObject({
          error: { code: "confirmation_required" },
        });
        expect(requests).toHaveLength(0);

        const { stdout } = await runCli(
          [
            "--json",
            "jobs",
            "cancel",
            "job_123",
            "--confirm-submit",
            "--agent",
            "--idempotency-key",
            "cancel-1",
          ],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          data: {
            job_id: "job_123",
            status: "CANCELED",
            canceled: true,
            status_url: "[redacted]",
          },
          agent: { safe: true },
        });
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/jobs/job_123/cancel",
          body: {},
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("cancel-1");
      },
    );
  });

  it("watches one job with an agent-safe terminal aggregate", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_123",
          status: "COMPLETED",
          result_url: "https://api.sume.com/private/job_123/result",
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          ["--json", "jobs", "watch", "job_123", "--agent"],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          kind: "job_watch",
          status: "terminal",
          terminal: true,
          watched_count: 1,
          completed_count: 1,
          failed_count: 0,
          active_count: 0,
          items: [
            expect.objectContaining({
              job_id: "job_123",
              status: "COMPLETED",
              terminal: true,
            }),
          ],
          agent: {
            safe: true,
            next_steps: expect.arrayContaining([
              "Use sume jobs result <job_id> --agent --json for completed jobs.",
            ]),
          },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]?.url).toBe("/v1/jobs/job_123/status");
      },
    );
  });

  it("watches multiple jobs once and reports non-terminal mixed status", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/jobs/job_done/status") {
          return {
            data: {
              request_id: "job_done",
              status: "succeeded",
              result_url: "https://api.sume.com/private/job_done/result",
            },
          };
        }
        return {
          data: {
            request_id: "job_active",
            status: "running",
            status_url: "https://api.sume.com/private/job_active/status",
          },
        };
      },
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "jobs",
            "watch",
            "--ids",
            "job_done,job_active",
            "--agent",
            "--interval-seconds",
            "0",
            "--timeout-seconds",
            "0",
          ],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          kind: "job_watch",
          status: "timeout",
          terminal: false,
          watched_count: 2,
          completed_count: 1,
          failed_count: 0,
          active_count: 1,
          items: [
            expect.objectContaining({
              job_id: "job_done",
              status: "succeeded",
              terminal: true,
            }),
            expect.objectContaining({
              job_id: "job_active",
              status: "running",
              terminal: false,
            }),
          ],
          agent: {
            safe: true,
          },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/jobs/job_done/status",
          "/v1/jobs/job_active/status",
        ]);
      },
    );
  });

  it("submits avatar prompt jobs with idempotency and JSON output", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_avatar",
          status_url: "https://api.sume.com/v1/jobs/job_avatar/status",
          result_url: "https://api.sume.com/v1/jobs/job_avatar/result",
          idempotency_hit: false,
          sync: null,
          job: {
            id: "job_avatar",
            type: "avatar_generation",
            status: "queued",
          },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-submit",
            "--avatar-handle",
            "presenter",
            "--prompt",
            "A friendly presenter",
            "--idempotency-key",
            "request-1",
          ],
          baseUrl,
        );
        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            request_id: "job_avatar",
            job: {
              status: "queued",
              type: "avatar_generation",
            },
          },
        });
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/models/sume/avatar/v1.0/runs",
          body: {
            avatar_handle: "presenter",
            input: {
              type: "prompt",
              prompt: "A friendly presenter",
            },
          },
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("request-1");
      },
    );
  });

  it("documents and submits launch-shaped Avatar 1.0 model runs without provider terms", async () => {
    const help = await execFileAsync(tsx, [
      "src/index.ts",
      "avatars",
      "create",
      "--help",
    ]);
    expect(help.stdout).toContain("--avatar-handle");
    expect(help.stdout).toContain("--image-url");
    expect(help.stdout).not.toContain("--quality");
    expect(help.stdout).not.toMatch(/--pro\b/u);
    expect(help.stdout).not.toContain("sume/avatar/v1.0-pro");
    expect(help.stdout).not.toMatch(/seedance|bytedance|fal/iu);

    await withMockApi(
      (request) => {
        if (request.url === "/v1/models/sume/avatar/v1.0/runs") {
          return {
            data: {
              request_id: "job_avatar_launch",
              model: "sume/avatar/v1.0",
              job: {
                id: "job_avatar_launch",
                status: "queued",
                model: "sume/avatar/v1.0",
              },
            },
          };
        }
        throw new Error(`Unexpected request: ${request.url}`);
      },
      async (baseUrl, requests) => {
        const payload = JSON.stringify({
          avatar_handle: "presenter",
          input: {
            type: "prompt",
            prompt: "A friendly presenter",
          },
        });
        const { stdout } = await runCli(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-paid",
            "--payload-json",
            payload,
            "--idempotency-key",
            "request-high-1",
          ],
          baseUrl,
        );

        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            request_id: "job_avatar_launch",
            model: "sume/avatar/v1.0",
            job: {
              model: "sume/avatar/v1.0",
              status: "queued",
            },
          },
        });
        expect(JSON.stringify(JSON.parse(stdout))).not.toMatch(
          /seedance|bytedance|fal/iu,
        );
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/models/sume/avatar/v1.0/runs",
          body: JSON.parse(payload),
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("request-high-1");
      },
    );
  });

  it("rejects deprecated Avatar quality flags before making API calls", async () => {
    await withMockApi(
      () => {
        throw new Error("No API calls expected.");
      },
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-paid",
            "--quality",
            "fast",
            "--avatar-handle",
            "Presenter",
            "--prompt",
            "A friendly presenter",
          ],
          baseUrl,
        );
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: {
            code: "invalid_argument",
            message: expect.stringContaining("unknown option '--quality'"),
          },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("rejects stale Avatar exact payload file URL fields before making API calls", async () => {
    await withMockApi(
      () => {
        throw new Error("No API calls expected.");
      },
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-paid",
            "--payload-json",
            JSON.stringify({
              avatar_handle: "photo_presenter",
              input: {
                type: "photo",
                file_url: "https://example.com/photo.png",
              },
            }),
          ],
          baseUrl,
        );
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: {
            code: "invalid_argument",
            message: expect.stringContaining(
              "input.file_url is not part of the launch Avatar model-run request",
            ),
          },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("submits avatar photo jobs from a public image URL", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/models/sume/avatar/v1.0/runs") {
          return {
            data: {
              request_id: "job_avatar_photo",
              job: { id: "job_avatar_photo", status: "queued" },
            },
          };
        }
        throw new Error(`Unexpected request: ${request.url}`);
      },
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-paid",
            "--type",
            "photo",
            "--avatar-handle",
            "photo_presenter",
            "--image-url",
            "https://example.com/reference.jpg",
            "--idempotency-key",
            "avatar-photo-1",
          ],
          baseUrl,
        );
        expect(JSON.stringify(JSON.parse(stdout))).not.toContain("signed");
        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            request_id: "job_avatar_photo",
            job: { status: "queued" },
          },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/models/sume/avatar/v1.0/runs",
        ]);
        expect(requests[0]).toMatchObject({
          method: "POST",
          body: {
            avatar_handle: "photo_presenter",
            input: {
              type: "photo",
              image_url: "https://example.com/reference.jpg",
            },
          },
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("avatar-photo-1");
      },
    );
  });

  it("lists and gets avatar resources with agent-safe output", async () => {
    await withMockApi(
      (request) => {
        if (request.url.startsWith("/v1/avatars?")) {
          return {
            data: {
              avatars: [
                {
                  id: "avatar_123",
                  name: "Presenter",
                  status: "ready",
                  preview_url: "https://media.sume.com/avatar-preview.png",
                },
              ],
            },
          };
        }
        return {
          data: {
            avatar: {
              id: "avatar_123",
              status: "ready",
              preview_url: "https://media.sume.com/avatar-preview.png",
            },
            job: { id: "job_avatar", status: "completed" },
          },
        };
      },
      async (baseUrl, requests) => {
        const list = await runCli(["--json", "avatars", "list", "--agent"], baseUrl);
        const get = await runCli(
          ["--json", "avatars", "get", "avatar_123", "--agent"],
          baseUrl,
        );
        expect(JSON.stringify(JSON.parse(list.stdout))).not.toContain("https://");
        expect(JSON.parse(list.stdout)).toMatchObject({
          data: {
            avatars: [
              expect.objectContaining({
                id: "avatar_123",
                preview_url: "[redacted]",
              }),
            ],
          },
          agent: { safe: true },
        });
        expect(JSON.stringify(JSON.parse(get.stdout))).not.toContain("https://");
        expect(JSON.parse(get.stdout)).toMatchObject({
          data: {
            avatar: {
              id: "avatar_123",
              preview_url: "[redacted]",
            },
            job: { id: "job_avatar" },
          },
          agent: { safe: true },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/avatars?limit=20",
          "/v1/avatars/avatar_123",
        ]);
      },
    );
  });

  it("prints avatar list filters and a ready-avatar selection table", async () => {
    await withMockApi(
      () => ({
        data: {
          avatars: [
            {
              id: "avatar_ready_123",
              handle: "korean_presenter",
              name: "Korean Presenter",
              resource_status: "ready",
              job_status: "completed",
              job_id: "job_ready",
              source_type: "prompt",
              updated_at: "2026-06-29T05:00:00.000Z",
              artifacts: [
                { kind: "avatar_base" },
                { kind: "idle_still" },
                { kind: "idle_video" },
                { kind: "background_removed_video" },
                { kind: "idle_loop" },
              ],
            },
            {
              id: "avatar_failed_456",
              name: "Failed Presenter",
              resource_status: "failed",
              job_status: "failed",
              job_id: "job_failed",
              source_type: "prompt",
              updated_at: "2026-06-29T04:00:00.000Z",
              artifacts: [],
            },
          ],
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "avatars",
            "list",
            "--handle",
            "@korean_presenter",
            "--status",
            "ready",
            "--limit",
            "10",
          ],
          baseUrl,
        );
        expect(stdout).toContain("Avatars.");
        expect(stdout).toContain("Handle: @korean_presenter");
        expect(stdout).toContain("Limit: 10");
        expect(stdout).toContain("Status: ready");
        expect(stdout).toContain("ID");
        expect(stdout).toContain("Name");
        expect(stdout).toContain("avatar_ready_123");
        expect(stdout).toContain("korean_presenter");
        expect(stdout).toContain("ready");
        expect(stdout).toContain("job_ready (completed)");
        expect(stdout).toContain("avatar_base");
        expect(stdout).toContain("+1");
        expect(stdout).toContain("avatar-videos create --avatar-handle");
        expect(stdout).not.toContain("https://");
        expect(requests[0]?.url).toBe(
          "/v1/avatars?handle=%40korean_presenter&limit=10&status=ready",
        );
      },
    );
  });

  it("prints avatar details and artifact kinds without raw URLs", async () => {
    await withMockApi(
      () => ({
        data: {
          avatar: {
            id: "avatar_123",
            handle: "korean_presenter",
            name: "Korean Presenter",
            resource_status: "ready",
            job_status: "completed",
            job_id: "job_avatar",
            source_type: "prompt",
            created_at: "2026-06-29T04:00:00.000Z",
            updated_at: "2026-06-29T05:00:00.000Z",
            preview_url: "https://media.sume.com/avatar-preview.png",
            artifacts: {
              avatar_base: { url: "https://media.sume.com/avatar-base.png" },
              idle_still: { url: "https://media.sume.com/idle-still.png" },
              idle_video: { url: "https://media.sume.com/idle-video.mp4" },
              background_removed_video: {
                url: "https://media.sume.com/background-removed-video.webm",
              },
              idle_loop: { url: "https://media.sume.com/idle-loop.webm" },
            },
          },
          job: { id: "job_avatar", status: "completed" },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(["avatars", "get", "avatar_123"], baseUrl);
        expect(stdout).toContain("Avatar.");
        expect(stdout).toContain("ID");
        expect(stdout).toContain("avatar_123");
        expect(stdout).toContain("korean_presenter");
        expect(stdout).toContain("Status");
        expect(stdout).toContain("ready");
        expect(stdout).toContain("job_avatar (completed)");
        expect(stdout).toContain("avatar_base");
        expect(stdout).toContain("idle_loop");
        expect(stdout).toContain(
          "sume avatar-videos create --avatar-handle korean_presenter",
        );
        expect(stdout).not.toContain("https://");
        expect(requests[0]?.url).toBe("/v1/avatars/avatar_123");
      },
    );
  });

  it("registers input assets with confirmation, idempotency, and agent redaction", async () => {
    await withMockApi(
      () => ({
        data: {
          asset: {
            id: "asset_123",
            media_type: "image",
            status: "registered",
            url: "https://api.sume.com/private/assets/asset_123.png",
            source: { type: "remote_url", url_present: true },
            created_at: "2026-06-26T00:00:00.000Z",
            updated_at: "2026-06-26T00:00:00.000Z",
            archived_at: null,
          },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "assets",
            "create",
            "--confirm-submit",
            "--agent",
            "--source-url",
            "https://example.com/reference.png",
            "--media-type",
            "image",
            "--idempotency-key",
            "asset-request-1",
          ],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          data: {
            asset: {
              id: "asset_123",
              media_type: "image",
              status: "registered",
              url: "[redacted]",
              source: { type: "remote_url", url_present: true },
            },
          },
          agent: {
            safe: true,
            next_steps: expect.arrayContaining([
              "Use sume assets get <asset_id> --agent --json to refresh asset metadata.",
            ]),
          },
        });
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/assets",
          body: {
            source_url: "https://example.com/reference.png",
            media_type: "image",
          },
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("asset-request-1");
      },
    );
  });

  it("refuses asset registration without explicit confirmation", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "assets",
            "create",
            "--source-url",
            "https://example.com/reference.png",
          ],
          baseUrl,
        );
        expect(error.stdout ?? "").toBe("");
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: { code: "confirmation_required" },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("gets input assets with agent-safe URL redaction", async () => {
    await withMockApi(
      () => ({
        data: {
          asset: {
            id: "asset_123",
            media_type: "image",
            status: "mirrored",
            url: "https://api.sume.com/private/assets/asset_123.png",
            source: { type: "remote_url", url_present: true },
            created_at: "2026-06-26T00:00:00.000Z",
            updated_at: "2026-06-26T00:00:00.000Z",
            archived_at: null,
          },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          ["--json", "assets", "get", "asset_123", "--agent"],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          data: {
            asset: {
              id: "asset_123",
              status: "mirrored",
              url: "[redacted]",
            },
          },
          agent: {
            safe: true,
            next_steps: expect.arrayContaining([
              "Use sume assets list --agent --json when you need to browse known assets.",
            ]),
          },
        });
        expect(requests[0]?.url).toBe("/v1/assets/asset_123");
      },
    );
  });

  it("lists input assets with filters and agent redaction", async () => {
    await withMockApi(
      () => ({
        data: {
          assets: [
            {
              id: "asset_123",
              media_type: "image",
              status: "ready",
              url: "https://api.sume.com/private/assets/asset_123.png",
            },
          ],
          next_cursor: null,
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "assets",
            "list",
            "--agent",
            "--limit",
            "10",
            "--media-type",
            "image",
            "--status",
            "ready",
          ],
          baseUrl,
        );
        const parsed = JSON.parse(stdout);
        expect(JSON.stringify(parsed)).not.toContain("https://");
        expect(parsed).toMatchObject({
          data: {
            assets: [
              expect.objectContaining({
                id: "asset_123",
                url: "[redacted]",
              }),
            ],
          },
          agent: { safe: true },
        });
        expect(requests[0]?.url).toBe(
          "/v1/assets?limit=10&media_type=image&status=ready",
        );
      },
    );
  });

  it("creates asset upload and download URLs with signed URL redaction", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/assets/upload-url") {
          return {
            data: {
              asset: { id: "asset_upload", media_type: "image", status: "pending_upload" },
              upload: {
                asset_id: "asset_upload",
                url: "https://storage.example/signed-upload",
                method: "PUT",
                headers: { "content-type": "image/png" },
                expires_at: "2026-06-27T00:00:00.000Z",
                max_bytes: 1000,
              },
            },
          };
        }
        return {
          data: {
            asset: { id: "asset_upload", media_type: "image", status: "ready" },
            download: {
              url: "https://storage.example/signed-download",
              method: "GET",
              expires_at: "2026-06-27T00:00:00.000Z",
            },
          },
        };
      },
      async (baseUrl, requests) => {
        const upload = await runCli(
          [
            "--json",
            "assets",
            "upload-url",
            "--confirm-submit",
            "--agent",
            "--content-type",
            "image/png",
            "--size-bytes",
            "1000",
            "--media-type",
            "image",
            "--filename",
            "reference.png",
            "--idempotency-key",
            "upload-1",
          ],
          baseUrl,
        );
        const uploadParsed = JSON.parse(upload.stdout);
        expect(JSON.stringify(uploadParsed)).not.toContain("https://");
        expect(uploadParsed).toMatchObject({
          data: {
            upload: {
              asset_id: "asset_upload",
              url: "[redacted]",
            },
          },
          agent: { safe: true },
        });

        const download = await runCli(
          ["--json", "assets", "download-url", "asset_upload", "--agent"],
          baseUrl,
        );
        const downloadParsed = JSON.parse(download.stdout);
        expect(JSON.stringify(downloadParsed)).not.toContain("https://");
        expect(downloadParsed).toMatchObject({
          data: {
            download: {
              url: "[redacted]",
            },
          },
          agent: { safe: true },
        });

        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/assets/upload-url",
          body: {
            content_type: "image/png",
            size_bytes: 1000,
            media_type: "image",
            filename: "reference.png",
          },
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("upload-1");
        expect(requests[1]?.url).toBe("/v1/assets/asset_upload/download-url");
      },
    );
  });

  it("completes direct-uploaded assets with confirmation", async () => {
    await withMockApi(
      () => ({
        data: {
          asset: {
            id: "asset_upload",
            media_type: "image",
            status: "ready",
          },
        },
      }),
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          ["--json", "assets", "complete", "asset_upload"],
          baseUrl,
        );
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: { code: "confirmation_required" },
        });
        expect(requests).toHaveLength(0);

        const { stdout } = await runCli(
          [
            "--json",
            "assets",
            "complete",
            "asset_upload",
            "--confirm-submit",
            "--agent",
            "--size-bytes",
            "1000",
            "--idempotency-key",
            "complete-1",
          ],
          baseUrl,
        );
        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            asset: {
              id: "asset_upload",
              status: "ready",
            },
          },
          agent: { safe: true },
        });
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/assets/asset_upload/complete",
          body: { size_bytes: 1000 },
        });
        expect(requests[0]?.headers["idempotency-key"]).toBe("complete-1");
      },
    );
  });

  it("refuses avatar submission without explicit confirmation", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "avatars",
            "create",
            "--avatar-handle",
            "Presenter",
            "--prompt",
            "A friendly presenter",
          ],
          baseUrl,
        );
        expect(error.stdout ?? "").toBe("");
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: { code: "confirmation_required" },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("rejects unsupported avatar props ethnicity before submission", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-submit",
            "--type",
            "props",
            "--avatar-handle",
            "Presenter",
            "--ethnicity",
            "Korean",
            "--sex",
            "female",
            "--age",
            "24",
          ],
          baseUrl,
        );
        expect(error.stdout ?? "").toBe("");
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: {
            code: "invalid_argument",
            message:
              "ethnicity must be Asian, South Asian, Southeast Asian, Black, Hispanic, Middle Eastern, White, or Wasian.",
          },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("rejects avatar props age above the public API limit before submission", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "avatars",
            "create",
            "--confirm-submit",
            "--type",
            "props",
            "--avatar-handle",
            "Presenter",
            "--ethnicity",
            "Asian",
            "--sex",
            "female",
            "--age",
            "81",
          ],
          baseUrl,
        );
        expect(error.stdout ?? "").toBe("");
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: {
            code: "invalid_argument",
            message: expect.stringContaining("between 20 and 80"),
          },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("plans and submits avatar batches with state and idempotency", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/models/sume/avatar/v1.0/runs") {
          return {
            data: {
              request_id: "job_avatar_1",
              job: { id: "job_avatar_1", status: "queued" },
            },
          };
        }
        if (request.url === "/v1/jobs/job_avatar_1/status") {
          return { data: { job: { id: "job_avatar_1", status: "completed" } } };
        }
        throw new Error(`Unexpected request: ${request.url}`);
      },
      async (baseUrl, requests) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-avatar-batch-"));
        try {
          const manifestFile = path.join(tempDir, "avatars.batch.json");
          const stateFile = path.join(tempDir, "avatars.state.json");
          fs.writeFileSync(
            manifestFile,
            JSON.stringify({
              avatars: [
                {
	                  id: "presenter",
	                  type: "prompt",
	                  avatar_handle: "presenter",
	                  prompt: "A friendly presenter",
                },
              ],
            }),
          );

          const plan = await runCli(
            ["--json", "avatars", "batch", "plan", manifestFile],
            baseUrl,
          );
          expect(JSON.parse(plan.stdout)).toMatchObject({
            object: "batch_plan",
            workflow: "avatar",
            ready: true,
            count: 1,
          });
          expect(requests).toHaveLength(0);

          const blocked = await runCliFailure(
            ["--json", "avatars", "batch", "create", manifestFile, "--state-file", stateFile],
            baseUrl,
          );
          expect(JSON.parse(blocked.stderr ?? "")).toMatchObject({
            error: { code: "confirmation_required" },
          });

          const created = await runCli(
            [
              "--json",
              "avatars",
              "batch",
              "create",
              manifestFile,
              "--state-file",
              stateFile,
              "--idempotency-key-prefix",
              "avatar-test",
              "--confirm-paid",
            ],
            baseUrl,
          );
          expect(JSON.parse(created.stdout)).toMatchObject({
            object: "batch_state",
            workflow: "avatar",
            items: [expect.objectContaining({ id: "presenter", job_id: "job_avatar_1" })],
          });
          expect(requests[0]).toMatchObject({
            method: "POST",
            url: "/v1/models/sume/avatar/v1.0/runs",
	            body: {
	              avatar_handle: "presenter",
	              input: {
	                type: "prompt",
	                prompt: "A friendly presenter",
	              },
	            },
	          });
          expect(requests[0]?.headers["idempotency-key"]).toBe(
            "avatar-test:presenter",
          );

          const watched = await runCli(
            [
              "--json",
              "avatars",
              "batch",
              "watch",
              manifestFile,
              "--state-file",
              stateFile,
              "--timeout-seconds",
              "0",
            ],
            baseUrl,
          );
          expect(JSON.parse(watched.stdout)).toMatchObject({
            object: "batch_watch",
            terminal: true,
            completed_count: 1,
          });
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("submits avatar video jobs with webhook mode", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_video",
          status_url: "https://api.sume.com/v1/jobs/job_video/status",
          result_url: "https://api.sume.com/v1/jobs/job_video/result",
          idempotency_hit: false,
          job: {
            id: "job_video",
            type: "avatar_video",
            status: "queued",
            communication_mode: "webhook",
          },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "avatar-videos",
            "create",
            "--confirm-paid",
            "--script",
            "Say hello.",
            "--product-image",
            "https://example.com/product.png",
            "--avatar-handle",
            "@studio_presenter",
            "--scene-prompt",
            "Clean studio",
            "--mode",
            "webhook",
            "--webhook-url",
            "https://example.com/callback",
          ],
          baseUrl,
        );
        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            request_id: "job_video",
            job: { type: "avatar_video" },
          },
        });
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/models/sume/avatar-video/v1.0/runs",
          body: {
            script: "Say hello.",
            product_image: "https://example.com/product.png",
            quality: "standard",
            avatar_handle: "@studio_presenter",
            scene: {
              type: "prompt",
              prompt: "Clean studio",
            },
            mode: "webhook",
            webhook_url: "https://example.com/callback",
          },
        });
      },
    );
  });

  it("submits productless avatar video jobs from friendly flags", async () => {
    await withMockApi(
      () => ({
        data: {
          request_id: "job_video",
          job: {
            id: "job_video",
            type: "avatar_video",
            status: "queued",
          },
        },
      }),
      async (baseUrl, requests) => {
        const { stdout } = await runCli(
          [
            "--json",
            "avatar-videos",
            "create",
            "--confirm-paid",
            "--script",
            "Say hello.",
            "--avatar-handle",
            "@studio_presenter",
          ],
          baseUrl,
        );
        expect(JSON.parse(stdout)).toMatchObject({
          data: {
            request_id: "job_video",
            job: { type: "avatar_video" },
          },
        });
        expect(requests[0]).toMatchObject({
          method: "POST",
          url: "/v1/models/sume/avatar-video/v1.0/runs",
          body: {
            script: "Say hello.",
            quality: "standard",
            avatar_handle: "@studio_presenter",
          },
        });
        expect(requests[0]?.body).not.toHaveProperty("product_image");
      },
    );
  });

  it("rejects avatar-video scripts outside the local duration limit", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const tooLong = await runCliFailure(
          [
            "--json",
            "avatar-videos",
            "create",
            "--confirm-paid",
            "--script",
            words(169),
            "--product-image",
            "https://example.com/product.png",
            "--avatar-handle",
            "avatar_123",
          ],
          baseUrl,
        );
        expect(JSON.parse(tooLong.stderr ?? "")).toMatchObject({
          error: {
            code: "invalid_argument",
            message: expect.stringContaining("maximum is 60 seconds"),
          },
        });

        const whitespace = await runCliFailure(
          [
            "--json",
            "avatar-videos",
            "create",
            "--confirm-paid",
            "--payload-json",
            JSON.stringify({
              script: "   \n\t",
              product_image: "https://example.com/product.png",
              avatar_handle: "avatar_123",
            }),
          ],
          baseUrl,
        );
        expect(JSON.parse(whitespace.stderr ?? "")).toMatchObject({
          error: {
            code: "invalid_argument",
            message: "Avatar video script must include at least one word.",
          },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("plans and submits avatar-video batches with selected avatar defaults", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/models/sume/avatar-video/v1.0/runs") {
          return {
            data: {
              request_id: "job_video_1",
              job: { id: "job_video_1", status: "queued" },
            },
          };
        }
        throw new Error(`Unexpected request: ${request.url}`);
      },
      async (baseUrl, requests) => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-video-batch-"));
        try {
          const manifestFile = path.join(tempDir, "videos.batch.json");
          const stateFile = path.join(tempDir, "videos.state.json");
          fs.writeFileSync(
            manifestFile,
            JSON.stringify({
              defaults: {
                avatar_handle: "avatar_ready",
                scene_prompt: "Clean studio",
              },
              videos: [{ id: "intro", script: "Say hello." }],
            }),
          );

          const plan = await runCli(
            ["--json", "avatar-videos", "batch", "plan", manifestFile],
            baseUrl,
          );
          expect(JSON.parse(plan.stdout)).toMatchObject({
            workflow: "avatar-video",
            ready: true,
            items: [expect.objectContaining({ id: "intro" })],
          });

          const created = await runCli(
            [
              "--json",
              "avatar-videos",
              "batch",
              "create",
              manifestFile,
              "--state-file",
              stateFile,
              "--confirm-paid",
            ],
            baseUrl,
          );
          expect(JSON.parse(created.stdout)).toMatchObject({
            workflow: "avatar-video",
            items: [expect.objectContaining({ id: "intro", job_id: "job_video_1" })],
          });
          expect(requests[0]).toMatchObject({
            method: "POST",
            url: "/v1/models/sume/avatar-video/v1.0/runs",
	            body: {
	              script: "Say hello.",
	              quality: "standard",
	              avatar_handle: "avatar_ready",
	              scene: { type: "prompt", prompt: "Clean studio" },
	            },
          });
          expect(requests[0]?.body).not.toHaveProperty("product_image");
          expect(requests[0]?.headers["idempotency-key"]).toBe(
            "sume-avatar-video-batch:intro",
          );

          const legacyManifestFile = path.join(tempDir, "legacy.batch.json");
          fs.writeFileSync(
            legacyManifestFile,
            JSON.stringify({
              defaults: {
                avatar_handle: "avatar_ready",
                product_image: "https://example.com/product.png",
                background: "Old alias",
              },
              videos: [{ id: "legacy", script: "Say hello." }],
            }),
          );
          const legacyPlan = await runCli(
            ["--json", "avatar-videos", "batch", "plan", legacyManifestFile],
            baseUrl,
          );
          expect(JSON.parse(legacyPlan.stdout)).toMatchObject({
            workflow: "avatar-video",
            ready: false,
            items: [
              expect.objectContaining({
                id: "legacy",
                ready: false,
                errors: expect.arrayContaining([
                  "background is not supported; use scene_prompt or scene_image_url",
                ]),
              }),
            ],
          });

          const durationManifestFile = path.join(tempDir, "duration.batch.json");
          fs.writeFileSync(
            durationManifestFile,
            JSON.stringify({
              defaults: {
                avatar_handle: "avatar_ready",
                product_image: "https://example.com/product.png",
              },
              videos: [
                { id: "empty", script: " \n\t " },
                { id: "long", script: words(169) },
              ],
            }),
          );
          const durationPlan = await runCli(
            ["--json", "avatar-videos", "batch", "plan", durationManifestFile],
            baseUrl,
          );
          expect(JSON.parse(durationPlan.stdout)).toMatchObject({
            workflow: "avatar-video",
            ready: false,
            items: [
              expect.objectContaining({
                id: "empty",
                ready: false,
                errors: ["Avatar video script must include at least one word."],
              }),
              expect.objectContaining({
                id: "long",
                ready: false,
                errors: [
                  expect.stringContaining("maximum is 60 seconds"),
                ],
              }),
            ],
          });
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("lists and gets avatar video resources with agent-safe output", async () => {
    await withMockApi(
      (request) => {
        if (request.url === "/v1/avatar-videos") {
          return {
            data: {
              avatar_videos: [
                {
                  id: "avatar_video_123",
                  status: "ready",
                  video_url: "https://media.sume.com/avatar-video.mp4",
                },
              ],
            },
          };
        }
        return {
          data: {
            avatar_video: {
              id: "avatar_video_123",
              status: "ready",
              video_url: "https://media.sume.com/avatar-video.mp4",
            },
            job: { id: "job_video", status: "completed" },
          },
        };
      },
      async (baseUrl, requests) => {
        const list = await runCli(
          ["--json", "avatar-videos", "list", "--agent"],
          baseUrl,
        );
        const get = await runCli(
          ["--json", "avatar-videos", "get", "avatar_video_123", "--agent"],
          baseUrl,
        );
        expect(JSON.stringify(JSON.parse(list.stdout))).not.toContain("https://");
        expect(JSON.parse(list.stdout)).toMatchObject({
          data: {
            avatar_videos: [
              expect.objectContaining({
                id: "avatar_video_123",
                video_url: "[redacted]",
              }),
            ],
          },
          agent: { safe: true },
        });
        expect(JSON.stringify(JSON.parse(get.stdout))).not.toContain("https://");
        expect(JSON.parse(get.stdout)).toMatchObject({
          data: {
            avatar_video: {
              id: "avatar_video_123",
              video_url: "[redacted]",
            },
            job: { id: "job_video" },
          },
          agent: { safe: true },
        });
        expect(requests.map((request) => request.url)).toEqual([
          "/v1/avatar-videos",
          "/v1/avatar-videos/avatar_video_123",
        ]);
      },
    );
  });

  it("refuses avatar video submission without explicit confirmation", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        const error = await runCliFailure(
          [
            "--json",
            "avatar-videos",
            "create",
            "--script",
            "Say hello.",
            "--product-image",
            "https://example.com/product.png",
            "--avatar-handle",
            "avatar_123",
          ],
          baseUrl,
        );
        expect(error.stdout ?? "").toBe("");
        expect(JSON.parse(error.stderr ?? "")).toMatchObject({
          error: { code: "confirmation_required" },
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  it("does not ship generic image or video generation commands", async () => {
    await withMockApi(
      () => ({ data: { ok: true } }),
      async (baseUrl, requests) => {
        for (const args of [
          ["--json", "images", "create", "--prompt", "Clean product ad"],
          ["--json", "videos", "create", "--prompt", "Creator applies serum"],
        ]) {
          const error = await runCliFailure(args, baseUrl);
          expect(error.stdout ?? "").toBe("");
          expect(JSON.parse(error.stderr ?? "")).toMatchObject({
            error: { code: "invalid_argument" },
          });
        }
        expect(requests).toHaveLength(0);
      },
    );
  });
});

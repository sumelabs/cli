import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockApi, TEST_KEY } from "./helpers/mock-api.ts";
import { runCli, tempDir } from "./helpers/run-cli.ts";

let api: MockApi;
let config: string;
const cli = (args: string[], options: Parameters<typeof runCli>[1] = {}) =>
  runCli(args, { baseUrl: api.url, key: null, ...options, env: { SUME_CLI_CONFIG_DIR: config, ...options.env } });
const saved = () => JSON.parse(readFileSync(join(config, "config.json"), "utf8")) as Record<string, any>;
const browser = async (url: string) => {
  await fetch(url, { redirect: "follow" });
};

beforeAll(async () => {
  api = await new MockApi().start();
});
afterAll(async () => {
  await api.stop();
});
beforeEach(() => {
  api.requests.length = 0;
  api.oauth.tokenTtlSeconds = 3600;
  api.oauth.devicePendingPolls = 2;
  api.oauth.grants.length = 0;
  api.oauth.revoked.length = 0;
  config = tempDir("sume-login-");
});

describe("sume login", () => {
  it("signs in with a device code, keeps the sign-in owner-only, and runs with it", async () => {
    const res = await cli(["login", "--device", "--json"]);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("ABCD-EFGH");
    expect(res.stderr).toContain(`${api.url}/oauth/device?user_code=ABCD-EFGH`);
    expect(res.json()).toMatchObject({ signed_in: true, workspace: { name: "Personal" }, switchable: true });
    const stored = saved();
    expect(stored.api_key).toBeUndefined();
    expect(stored.session.access_token).toMatch(/^mcp_at_/u);
    expect(stored.session.resource).toBe(new URL(api.url).origin);
    if (process.platform !== "win32") expect(statSync(join(config, "config.json")).mode & 0o777).toBe(0o600);
    expect(res.stdout).not.toContain(stored.session.access_token);

    const run = await cli(["run", "gpt-image-2", "a cup", "--no-wait", "--json"]);
    expect(run.code).toBe(0);
    const submit = api.calls("POST", "/v1/image-router/generate")[0];
    expect(submit?.headers.authorization).toBe(`Bearer ${stored.session.access_token}`);

    const status = await cli(["auth", "status", "--json"]);
    expect(status.json()).toMatchObject({ valid: true, signed_in: true, key: null, key_source: "session" });
  });

  it("signs in through the browser with PKCE and a loopback redirect", async () => {
    const res = await cli(["login"], { tty: true, openUrl: browser });
    expect(res.code).toBe(0);
    expect(res.stderr).toContain(`${api.url}/oauth/authorize?`);
    expect(res.stderr).toContain("Signed in to Sume, working in Personal (personal).");
    expect(api.oauth.grants).toEqual(["authorization_code"]);
    expect(saved().session.refresh_token).toMatch(/^mcp_rt_/u);
  });

  it("uses a code instead of a browser when nothing can answer a prompt", async () => {
    const res = await cli(["login"]);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("ABCD-EFGH");
    expect(api.oauth.grants.every((g) => g.endsWith("device_code"))).toBe(true);
  });

  it("refreshes an expiring token once, even when two commands start together", async () => {
    api.oauth.tokenTtlSeconds = 30;
    expect((await cli(["login", "--device"])).code).toBe(0);
    const before = saved().session.refresh_token;
    api.oauth.grants.length = 0;
    const [a, b] = await Promise.all([cli(["jobs", "list", "--json"]), cli(["jobs", "list", "--json"])]);
    expect([a.code, b.code]).toEqual([0, 0]);
    expect(api.oauth.grants.filter((g) => g === "refresh_token").length).toBeGreaterThanOrEqual(1);
    expect(saved().session.refresh_token).not.toBe(before);
    expect((await cli(["jobs", "list", "--json"])).code).toBe(0);
  });

  it("refreshes and retries once when the API refuses an expired token", async () => {
    expect((await cli(["login", "--device"])).code).toBe(0);
    api.expireAccessTokens();
    api.oauth.grants.length = 0;
    const res = await cli(["jobs", "list", "--json"]);
    expect(res.code).toBe(0);
    expect(api.oauth.grants).toEqual(["refresh_token"]);
  });

  it("asks to sign in again when the sign-in was revoked elsewhere", async () => {
    expect((await cli(["login", "--device"])).code).toBe(0);
    for (const token of api.oauth.refresh.values()) token.revoked = true;
    api.expireAccessTokens();
    const res = await cli(["jobs", "list", "--json"]);
    expect(res.code).toBe(3);
    expect(res.json()).toMatchObject({ error: { code: "login_required", hint: "Sign in again: sume login" } });
    expect(saved().session).toBeUndefined();
  });

  it("logout revokes the sign-in on the server and removes it", async () => {
    expect((await cli(["login", "--device"])).code).toBe(0);
    const { refresh_token } = saved().session;
    const res = await cli(["logout", "--json"]);
    expect(res.json()).toEqual({ removed: true, revoked: true, signed_out: true });
    expect(api.oauth.revoked).toContain(refresh_token);
    expect((await cli(["auth", "status", "--json"])).code).toBe(3);
  });

  it("auth logout still forgets a saved key, as before, and now also signs out", async () => {
    const key = await cli(["auth", "logout", "--json"]);
    expect(key.json()).toMatchObject({ removed: false });
    expect((await cli(["login", "--device"])).code).toBe(0);
    expect((await cli(["auth", "logout", "--json"])).json()).toMatchObject({ removed: true, revoked: true });
  });

  it("auth token prints the access token alone; an API key has none", async () => {
    expect((await cli(["login", "--device"])).code).toBe(0);
    const res = await cli(["auth", "token"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`${saved().session.access_token}\n`);

    const keyed = await cli(["auth", "token", "--json"], { key: TEST_KEY });
    expect(keyed.code).toBe(3);
    expect(keyed.json()).toMatchObject({ error: { code: "no_sign_in" } });
  });

  it("lists and switches workspaces with a sign-in; an API key cannot switch", async () => {
    expect((await cli(["login", "--device"])).code).toBe(0);
    const list = await cli(["workspaces", "list"]);
    expect(list.stdout).toMatch(/\*\s+Personal\s+personal\s+user_test/u);
    expect(list.stdout).toContain("Acme Team");

    const picked = await cli(["workspaces", "select", "acme team", "--json"]);
    expect(picked.json()).toMatchObject({
      workspace: { id: "org_acme" },
      previous_workspace_id: "user_test",
      outcome: "selected",
    });
    expect((await cli(["account", "get", "--json"])).json()).toMatchObject({ workspace: { name: "Acme Team" } });
    const human = await cli(["account", "get"]);
    expect(human.stdout).toContain("Sume sign-in");
    expect(human.stdout).toContain("with Sume (sume login)");
    expect(human.stdout).not.toContain("mcp_at_");
    expect((await cli(["workspaces", "select", "org_acme", "--json"])).json()).toMatchObject({ outcome: "unchanged" });

    const missing = await cli(["workspaces", "select", "Acme", "--json"]);
    expect(missing.code).toBe(4);
    expect(missing.json()).toMatchObject({ error: { code: "workspace_not_found" } });

    const keyed = await cli(["workspaces", "select", "Personal", "--json"], {
      key: TEST_KEY,
      env: { SUME_CLI_CONFIG_DIR: tempDir() },
    });
    expect(keyed.json()).toMatchObject({ outcome: "unchanged" });
  });

  it("explains that an API key cannot switch, with the sign-in command", async () => {
    const keyed = await cli(["workspaces", "select", "Acme Team", "--json"], { key: TEST_KEY });
    expect(keyed.code).toBe(4);
    expect(keyed.json()).toMatchObject({ error: { code: "workspace_fixed" } });
    expect(keyed.json<{ error: { hint: string } }>().error.hint).toContain("sume login");
    expect(api.calls("POST", "/v1/workspaces/select")).toHaveLength(0);
  });

  it("login --api-key saves a checked key and ends the sign-in", async () => {
    expect((await cli(["login", "--device"])).code).toBe(0);
    const { refresh_token } = saved().session;
    const res = await cli(["login", "--api-key", TEST_KEY]);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("A key on the command line can stay in your shell history");
    expect(saved()).toMatchObject({ api_key: TEST_KEY });
    expect(saved().session).toBeUndefined();
    expect(api.oauth.revoked).toContain(refresh_token);

    const bad = await cli(["login", "--api-key", "sume_live_wrong_wrong_wrong_wrong_wrong", "--json"]);
    expect(bad.code).toBe(3);
    expect(saved()).toMatchObject({ api_key: TEST_KEY });
  });

  it("never sends a sign-in made for one host to another", async () => {
    const other = await new MockApi().start();
    try {
      expect((await cli(["login", "--device"])).code).toBe(0);
      const res = await cli(["jobs", "list", "--json"], { baseUrl: other.url });
      expect(res.code).toBe(3);
      expect(res.json()).toMatchObject({ error: { code: "missing_api_key" } });
      expect(other.requests.filter((r) => r.headers.authorization)).toHaveLength(0);
      const status = await cli(["auth", "status", "--json"], { baseUrl: other.url });
      expect(status.json<{ hint: string }>().hint).toContain(`signed in for ${new URL(api.url).origin}`);
    } finally {
      await other.stop();
    }
  });
});

describe("sume login safety", () => {
  it("refuses a sign-in over plain http before contacting anything", async () => {
    const res = await runCli(["login", "--device", "--json"], {
      baseUrl: "http://example.invalid",
      key: null,
      env: { SUME_CLI_CONFIG_DIR: tempDir() },
    });
    expect(res.code).toBe(2);
    expect(res.json()).toMatchObject({ error: { code: "invalid_base_url" } });
  });

  it("still lists models and prices when a sign-in can no longer refresh", async () => {
    api.oauth.tokenTtlSeconds = 30;
    expect((await cli(["login", "--device"])).code).toBe(0);
    for (const token of api.oauth.refresh.values()) token.revoked = true;
    api.expireAccessTokens();
    const models = await cli(["models", "--json"]);
    expect(models.code).toBe(0);
    expect(models.json<unknown[]>().length).toBeGreaterThan(0);
  });
});

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockApi, TEST_KEY } from "./helpers/mock-api.ts";
import { runCli, tempDir } from "./helpers/run-cli.ts";

let api: MockApi;
const cli = (args: string[], options: Parameters<typeof runCli>[1] = {}) =>
  runCli(args, { baseUrl: api.url, key: TEST_KEY, ...options });

beforeAll(async () => {
  api = await new MockApi().start();
});
afterAll(async () => {
  await api.stop();
});
beforeEach(() => {
  api.requests.length = 0;
  api.balanceUsd = 10;
});

describe("account context", () => {
  it("balance shows dollars, credits and the workspace", async () => {
    const human = await cli(["balance"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("$10.00 (625 credits)");
    expect(human.stdout).toContain("Personal (personal)");

    const json = await cli(["balance", "--json"]);
    expect(json.json()).toMatchObject({
      balance: { available_usd: "10.00", available_credits: 625, state: "funded" },
      workspace: { id: "user_test", name: "Personal", kind: "personal" },
    });
  });

  it("balance says where to top up when there is nothing to spend", async () => {
    api.balanceUsd = 0;
    const res = await cli(["balance"]);
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("Nothing to spend. Top up at https://www.sume.com/dashboard/billing");
  });

  it("account get and me name the workspace the key bills", async () => {
    const human = await cli(["account", "get"]);
    expect(human.code).toBe(0);
    expect(human.stdout).toContain("Personal (personal)");
    expect(human.stdout).toContain("with an API key");
    expect(human.stdout).not.toContain(TEST_KEY);

    const json = await cli(["account", "get", "--json"]);
    expect(json.json()).toMatchObject({ account: { workspace_id: "user_test" }, workspace: { name: "Personal" } });
    expect((await cli(["me", "--json"])).json()).toEqual(json.json());
  });

  it("usage lists what jobs cost, as the docs write it (usage get) and as usage list", async () => {
    await cli(["run", "gpt-image-2", "a cup", "--no-wait", "--json"]);
    await cli(["run", "gpt-image-2", "a mug", "--no-wait", "--json"]);
    const docs = await cli(["usage", "get", "--limit", "1", "--json"]);
    expect(docs.code).toBe(0);
    expect(docs.json<{ usage: unknown[] }>().usage).toHaveLength(1);
    const list = await cli(["usage", "list"]);
    expect(list.code).toBe(0);
    expect(list.stdout).toContain("image_generation");
  });

  it("needs a key, and says so before calling the API", async () => {
    for (const args of [["balance"], ["account", "get"], ["usage", "list"]]) {
      const res = await cli([...args, "--json"], { key: null });
      expect(res.code).toBe(3);
      expect(res.json()).toMatchObject({ error: { code: "missing_api_key" } });
    }
    expect(api.requests).toHaveLength(0);
  });

  it("auth status adds the workspace and the balance to what it printed before", async () => {
    const json = await cli(["auth", "status", "--json"]);
    expect(json.code).toBe(0);
    expect(json.json()).toMatchObject({
      valid: true,
      key_source: "env",
      workspace: { id: "user_test", name: "Personal", kind: "personal" },
      balance: { available_usd: "10.00", available_credits: 625, state: "funded" },
    });
    const human = await cli(["auth", "status"]);
    expect(human.stdout).toContain("Workspace Personal (personal)");
    expect(human.stdout).toContain("Balance   $10.00 (625 credits)");
  });

  it("doctor names the workspace and warns when the balance is empty", async () => {
    api.balanceUsd = 0;
    const res = await cli(["doctor", "--json"]);
    const checks = res.json<{ checks: { name: string; status: string; detail: string; fix?: string }[] }>().checks;
    expect(checks.find((c) => c.name === "Key")?.detail).toContain("Personal (personal)");
    expect(checks.find((c) => c.name === "Balance")).toMatchObject({ status: "warn" });
  });

  it("a run with the key from ./.env says which key and workspace pay for it", async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".env"), `SUME_API_KEY=${TEST_KEY}\n`);
    const res = await cli(["run", "gpt-image-2", "a cup", "--no-wait"], { cwd, key: null });
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("Using SUME_API_KEY from ./.env");
    expect(res.stderr).toContain("it bills Personal (personal)");
    expect(res.stderr).not.toContain(TEST_KEY);

    const json = await cli(["run", "gpt-image-2", "a cup", "--no-wait", "--json"], { cwd, key: null });
    expect(json.stderr).toBe("");
  });
});

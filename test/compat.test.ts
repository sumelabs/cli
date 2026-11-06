import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { VERSION } from "../src/version.ts";
import { MockApi, TEST_KEY } from "./helpers/mock-api.ts";
import { runCli } from "./helpers/run-cli.ts";

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
});

describe("--version anywhere", () => {
  it("prints the version at any depth and does no work", async () => {
    const res = await cli(["run", "--version"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(`sume ${VERSION}\n`);
    expect((await cli(["jobs", "wait", "--version", "--json"])).json()).toMatchObject({ version: VERSION });
    expect(api.requests).toHaveLength(0);
  });

  it("gives way to --help when both are given", async () => {
    const res = await cli(["run", "--help", "--version"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Usage");
  });
});

describe("the commands sume.com/docs/cli lists", () => {
  it("catalog list runs models, with a note naming it", async () => {
    const json = await cli(["catalog", "list", "--json"], { key: null });
    expect(json.code).toBe(0);
    expect(json.json<{ id: string }[]>().map((m) => m.id)).toContain("gpt-image-2");
    expect(json.stderr).toBe("");
    const human = await cli(["catalog", "list"], { key: null });
    expect(human.stderr).toContain("`sume catalog list` is the older name; it runs `sume models`.");
    expect((await cli(["--help"])).stdout).not.toContain("catalog");
  });

  it("models list lists every model instead of filtering by the word list", async () => {
    const res = await cli(["models", "list", "--json"], { key: null });
    expect(res.code).toBe(0);
    expect(res.json<unknown[]>().length).toBe(
      (await cli(["models", "--json"], { key: null })).json<unknown[]>().length,
    );
  });

  it("jobs result shows a job's files, like jobs get", async () => {
    const submitted = await cli(["run", "gpt-image-2", "a cup", "--no-wait", "--json"]);
    const id = submitted.json<{ job: { id: string } }>().job.id;
    const res = await cli(["jobs", "result", id, "--json"]);
    expect(res.code).toBe(0);
    expect(res.json()).toMatchObject({ id });
  });
});

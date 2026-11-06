import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { vendoredRouter } from "../src/commands/schema.ts";
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

describe("request schemas in step with the API", () => {
  it("know the models the API serves now", () => {
    expect(vendoredRouter("gpt-image-2.6")).toBe("image");
    expect(vendoredRouter("kling-image-3-omni")).toBe("image");
    expect(vendoredRouter("kling-4")).toBe("video");
    expect(vendoredRouter("vidu-q3-pro")).toBe("video");
    expect(vendoredRouter("pixverse-v6")).toBe("video");
  });

  it("take project_id as a flag on both routers, kebab or snake case", async () => {
    const image = await cli([
      "run",
      "gpt-image-2",
      "a cup",
      "-q",
      "low",
      "--project-id",
      "prj_1",
      "--dry-run",
      "--json",
    ]);
    expect(image.code).toBe(0);
    expect(image.json()).toMatchObject({ body: { project_id: "prj_1" } });
    expect(image.json<{ warnings?: string[] }>().warnings).toBeUndefined();

    const video = await cli([
      "run",
      "seedance-2-mini",
      "a boat",
      "-d",
      "4",
      "--project_id",
      "prj_2",
      "--dry-run",
      "--json",
    ]);
    expect(video.code).toBe(0);
    expect(video.json()).toMatchObject({ body: { project_id: "prj_2" } });
  });

  it("send --set project_id without calling it an unknown field", async () => {
    const res = await cli(["run", "gpt-image-2", "a cup", "--set", "project_id=prj_1", "--dry-run", "--json"]);
    expect(res.code).toBe(0);
    expect(res.json<{ warnings?: string[] }>().warnings).toBeUndefined();
  });

  it("list project_id in a model's inputs", async () => {
    const res = await cli(["schema", "gpt-image-2", "--json"], { key: null });
    expect(res.code).toBe(0);
    expect(Object.keys(res.json<{ fields: Record<string, unknown> }>().fields)).toContain("project_id");
  });

  it("say when a flag is a field of the other kind of model, instead of a near-miss guess", async () => {
    const res = await cli(["run", "gpt-image-2", "a cup", "--seed", "3", "--dry-run"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("--seed is a field of video models; gpt-image-2 is an image model");
    expect(res.stderr).not.toContain("Did you mean --set?");
  });
});

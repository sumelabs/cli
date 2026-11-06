import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../src/api/errors.ts";
import { fieldFile, needsUploadToPrice, placeholderUrl } from "../src/lib/pricing.ts";
import { MockApi, PNG, TEST_KEY } from "./helpers/mock-api.ts";
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

const withClip = () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, "talk.png"), PNG);
  return cwd;
};

const estimates = () => api.calls("POST", "/v1/open/estimate").map((c) => c.body as { input: Record<string, string> });

describe("pricing a local file the price depends on", () => {
  it("uploads it first, then checks --max-usd against the uploaded file and submits", async () => {
    const cwd = withClip();
    const res = await cli(
      ["run", "veed-lipsync", "--video", "talk.png", "--audio", "https://x.example/line.wav", "-d", "6"].concat([
        "--max-usd",
        "1",
        "--json",
      ]),
      { cwd },
    );
    expect(res.code).toBe(0);
    expect(res.json()).toMatchObject({ job: { status: "completed" }, usd: "0.5274" });
    const [first, second] = estimates();
    expect(first?.input.video_url).toBe("https://upload.invalid/talk.png");
    expect(second?.input.video_url).toMatch(/\/media\/asset_\w+\.png$/u);
    const order = api.requests.map((r) => r.path);
    expect(order.indexOf("/v1/assets/upload-url")).toBeLessThan(order.lastIndexOf("/v1/open/estimate"));
    expect(api.calls("POST", "/v1/video-router/generate")).toHaveLength(1);
  });

  it("refuses a run over --max-usd after the upload, says the upload was free, and submits nothing", async () => {
    const cwd = withClip();
    const res = await cli(["run", "veed-lipsync", "--video", "talk.png", "-d", "6", "--max-usd", "0.01", "--json"], {
      cwd,
    });
    expect(res.code).toBe(7);
    const error = res.json<{ error: { code: string; message: string; hint: string } }>().error;
    expect(error.code).toBe("over_budget");
    expect(error.message).toContain("Nothing was submitted");
    expect(error.hint).toContain("uploaded to read their length");
    expect(api.calls("POST", "/v1/video-router/generate")).toHaveLength(0);
  });

  it("shows the uploaded file's price on a run without --max-usd", async () => {
    const cwd = withClip();
    const res = await cli(["run", "veed-lipsync", "--video", "talk.png", "-d", "6"], { cwd });
    expect(res.code).toBe(0);
    expect(res.stderr).toContain("veed-lipsync completed in");
    expect(res.stderr).toContain("$0.5274");
  });

  it("estimate names the file and the upload command, and uploads nothing", async () => {
    const res = await cli(["estimate", "veed-lipsync", "--video", "./talk.mp4", "-d", "6", "--json"]);
    expect(res.code).toBe(4);
    const error = res.json<{ error: { code: string; message: string; hint: string; status: number } }>().error;
    expect(error.code).toBe("media_unreadable");
    expect(error.status).toBe(400);
    expect(error.message).toContain("Can't price ./talk.mp4 before it is uploaded");
    expect(error.message).not.toContain("host name does not exist");
    expect(error.hint).toContain("sume upload ./talk.mp4");
    expect(api.calls("POST", "/v1/assets/upload-url")).toHaveLength(0);
  });

  it("estimate still prices a local file the price does not depend on, without a key or an upload", async () => {
    const res = await cli(["estimate", "seedance-2-mini", "-d", "4", "--image", "./still.png", "--json"], {
      key: null,
    });
    expect(res.code).toBe(0);
    expect(res.json()).toMatchObject({ usd: "0.3516" });
    expect(api.calls("POST", "/v1/assets/upload-url")).toHaveLength(0);
  });

  it("a dry run says which file the price needs, and uploads nothing", async () => {
    const cwd = withClip();
    const res = await cli(["run", "veed-lipsync", "--video", "talk.png", "-d", "6", "--dry-run", "--json"], {
      cwd,
    });
    expect(res.code).toBe(0);
    const out = res.json<{ estimate: unknown; warnings: string[] }>();
    expect(out.estimate).toBeNull();
    expect(out.warnings.join(" ")).toContain("Can't price talk.png before it is uploaded");
    expect(api.calls("POST", "/v1/assets/upload-url")).toHaveLength(0);
  });
});

describe("placeholder refusals", () => {
  const refusal = (details: Record<string, unknown>, code = "media_unreadable") =>
    new ApiError(400, { code, message: "video_url could not be read.", details });

  it("are told apart from a URL the person gave", () => {
    expect(needsUploadToPrice(refusal({ field: "video_url", source_host: "upload.invalid" }))).toBe(true);
    expect(needsUploadToPrice(refusal({ field: "video_url", source_host: "cdn.example.com" }))).toBe(false);
    expect(needsUploadToPrice(refusal({ source_host: "upload.invalid" }, "invalid_request"))).toBe(false);
    expect(needsUploadToPrice(new Error("upload.invalid"))).toBe(false);
  });

  it("name the local file behind the refused field", () => {
    const body = { video_url: "./a.mp4", reference_video_urls: ["https://x.example/b.mp4", "./c.mp4"] };
    const local = ["./a.mp4", "./c.mp4"];
    expect(fieldFile(refusal({ field: "video_url" }), body, local)).toBe("./a.mp4");
    expect(fieldFile(refusal({ field: "reference_video_urls[1]" }), body, local)).toBe("./c.mp4");
    expect(fieldFile(refusal({ field: "reference_video_urls[0]" }), body, local)).toBeUndefined();
    expect(placeholderUrl("dir/my clip.mp4")).toBe("https://upload.invalid/my%20clip.mp4");
  });
});

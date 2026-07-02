import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  downloadMediaFromValue,
  extractMediaRefs,
} from "../src/lib/download.js";

describe("media downloads", () => {
  it("extracts media URLs without treating API status/result URLs as media", () => {
    const refs = extractMediaRefs({
      data: {
        status_url: "https://api.sume.com/v1/jobs/job_1/status",
        result_url: "https://api.sume.com/v1/jobs/job_1/result",
        result: {
          video_url: "https://media.sume.com/video.mp4",
          thumbnail_url: "https://media.sume.com/thumb.png",
        },
      },
    });
    expect(refs.map((ref) => ref.url)).toEqual([
      "https://media.sume.com/video.mp4",
      "https://media.sume.com/thumb.png",
    ]);
  });

  it("downloads files without returning remote URLs", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-download-"));
    try {
      const result = await downloadMediaFromValue(
        {
          data: {
            result: {
              video_url: "https://media.sume.com/video.mp4",
            },
          },
        },
        {
          outputDir: tempDir,
          fetchImpl: (async () =>
            new Response(new Uint8Array([1, 2, 3]), {
              headers: { "content-type": "video/mp4" },
            })) as typeof fetch,
        },
      );
      expect(result).toMatchObject({
        object: "media_download",
        remote_urls_redacted: true,
        source_count: 1,
        downloaded: [
          expect.objectContaining({
            bytes: 3,
            content_type: "video/mp4",
          }),
        ],
      });
      expect(JSON.stringify(result)).not.toContain("https://");
      expect(fs.existsSync(result.downloaded[0]?.path ?? "")).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("does not reuse one requested filename for multiple artifacts", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-download-"));
    try {
      const result = await downloadMediaFromValue(
        {
          data: {
            result: {
              video_url: "https://media.sume.com/video.mp4",
              thumbnail_url: "https://media.sume.com/thumb.png",
            },
          },
        },
        {
          outputDir: tempDir,
          filename: "custom.bin",
          fetchImpl: (async () =>
            new Response(new Uint8Array([1]), {
              headers: { "content-type": "application/octet-stream" },
            })) as typeof fetch,
        },
      );
      expect(result.downloaded).toHaveLength(2);
      expect(result.downloaded.map((item) => item.filename)).toEqual([
        "video.mp4",
        "thumb.png",
      ]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

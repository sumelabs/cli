import { describe, expect, it } from "vitest";
import { CliError } from "../src/lib/errors.js";
import { SumeApiClient } from "../src/lib/api-client.js";
import { normalizeApiBaseUrl } from "../src/lib/config.js";

describe("SumeApiClient", () => {
  it("builds versioned API URLs with query params", () => {
    const client = new SumeApiClient({
      baseUrl: "https://api.sume.com/v1/",
      apiKey: "test-key",
    });

    expect(client.url("/catalog", { limit: 5 }).toString()).toBe(
      "https://api.sume.com/v1/catalog?limit=5",
    );
  });

  it("builds command URLs under /v1 for unversioned production API config", () => {
    const client = new SumeApiClient({
      baseUrl: normalizeApiBaseUrl("https://api.sume.com"),
      apiKey: "test-key",
    });

    expect(client.url("/me").toString()).toBe("https://api.sume.com/v1/me");
    expect(client.url("/avatars").toString()).toBe(
      "https://api.sume.com/v1/avatars",
    );
    expect(client.url("/jobs/job_123/status").toString()).toBe(
      "https://api.sume.com/v1/jobs/job_123/status",
    );
  });

  it("sets x-api-key auth by default", () => {
    const client = new SumeApiClient({
      baseUrl: "https://api.sume.com/v1",
      apiKey: "test-key",
    });

    expect(client.headers()["x-api-key"]).toBe("test-key");
    expect(client.headers().Authorization).toBeUndefined();
  });

  it("can use bearer auth for compatibility", () => {
    const client = new SumeApiClient({
      baseUrl: "https://api.sume.com/v1",
      apiKey: "test-key",
      authMode: "bearer",
    });

    expect(client.headers().Authorization).toBe("Bearer test-key");
    expect(client.headers()["x-api-key"]).toBeUndefined();
  });

  it("posts JSON bodies with extra request headers", async () => {
    const requests: Array<{ body: string | null; headers: Headers; method: string }> =
      [];
    const client = new SumeApiClient({
      baseUrl: "https://api.sume.com/v1",
      apiKey: "test-key",
      fetchImpl: async (_url, init) => {
        requests.push({
          body: typeof init?.body === "string" ? init.body : null,
          headers: new Headers(init?.headers),
          method: init?.method ?? "GET",
        });
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      },
    });

    await client.post(
      "/avatars",
      { type: "prompt", name: "Presenter", prompt: "Hello" },
      { headers: { "Idempotency-Key": "request-1" } },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe("request-1");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({
      type: "prompt",
      name: "Presenter",
      prompt: "Hello",
    });
  });

  it("raises API error envelopes for agents", async () => {
    const client = new SumeApiClient({
      baseUrl: "https://api.sume.com/v1",
      apiKey: "test-key",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            request_id: "req_123",
            error: {
              code: "job_not_completed",
              message: "Job is not completed.",
              details: { status: "queued" },
            },
          }),
          { status: 409 },
        ),
    });

    await expect(client.get("/jobs/job_123/result")).rejects.toMatchObject({
      code: "job_not_completed",
      message: "Job is not completed.",
      requestId: "req_123",
      status: 409,
      details: { status: "queued" },
    } satisfies Partial<CliError>);
  });
});

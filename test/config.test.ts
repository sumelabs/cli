import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearConfig,
  configPath,
  getApiBaseUrlDiagnostic,
  normalizeApiBaseUrl,
  readConfig,
  redactApiKey,
  resolveConfig,
  writeConfig,
} from "../src/lib/config.js";

let tempDir: string;

describe("config", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-cli-test-"));
    process.env.SUME_CONFIG_DIR = tempDir;
    delete process.env.SUME_API_KEY;
    delete process.env.SUME_API_AUTH_MODE;
    delete process.env.SUME_API_BASE_URL;
    delete process.env.SUME_APP_BASE_URL;
  });

  afterEach(() => {
    delete process.env.SUME_CONFIG_DIR;
    delete process.env.SUME_API_KEY;
    delete process.env.SUME_API_AUTH_MODE;
    delete process.env.SUME_API_BASE_URL;
    delete process.env.SUME_APP_BASE_URL;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reads and writes local config", () => {
    writeConfig({ apiKey: "local-key", baseUrl: "https://example.test/v1" });
    expect(readConfig()).toEqual({
      apiKey: "local-key",
      baseUrl: "https://example.test/v1",
    });
    expect(configPath()).toBe(path.join(tempDir, "config.json"));
  });

  it("prefers environment values over local config", () => {
    writeConfig({ apiKey: "local-key", baseUrl: "https://example.test/v1" });
    process.env.SUME_API_KEY = "env-key";
    process.env.SUME_API_AUTH_MODE = "bearer";
    expect(resolveConfig().apiKey).toBe("env-key");
    expect(resolveConfig().authMode).toBe("bearer");
  });

  it("reads legacy apiBaseUrl from local config", () => {
    fs.writeFileSync(
      configPath(),
      JSON.stringify({
        apiKey: "local-key",
        apiBaseUrl: "https://api.sume.com",
      }),
    );

    expect(readConfig()).toMatchObject({
      apiKey: "local-key",
      baseUrl: "https://api.sume.com",
    });
    expect(resolveConfig().baseUrl).toBe("https://api.sume.com/v1");
  });

  it("reads snake_case API base URL aliases from local config", () => {
    fs.writeFileSync(
      configPath(),
      JSON.stringify({
        apiKey: "local-key",
        base_url: "https://api.sume.com/",
        app_base_url: "https://app.sume.com/",
      }),
    );

    expect(readConfig()).toMatchObject({
      apiKey: "local-key",
      baseUrl: "https://api.sume.com/",
      appBaseUrl: "https://app.sume.com/",
    });
    expect(resolveConfig()).toMatchObject({
      baseUrl: "https://api.sume.com/v1",
      appBaseUrl: "https://app.sume.com",
    });
  });

  it("clears local config", () => {
    writeConfig({ apiKey: "local-key" });
    clearConfig();
    expect(readConfig()).toEqual({});
  });

  it("redacts API keys", () => {
    expect(redactApiKey("abcdef123456")).toBe("abcdef...3456");
  });

  it("defaults to x-api-key auth mode", () => {
    expect(resolveConfig().authMode).toBe("x-api-key");
  });

  it("derives app.sume.com for api.sume.com browser login", () => {
    process.env.SUME_API_BASE_URL = "https://api.sume.com";
    expect(resolveConfig().appBaseUrl).toBe("https://app.sume.com");
  });

  it("lets environment override the browser login app URL", () => {
    process.env.SUME_APP_BASE_URL = "http://127.0.0.1:3000/";
    expect(resolveConfig().appBaseUrl).toBe("http://127.0.0.1:3000");
  });

  it("normalizes auth mode aliases", () => {
    process.env.SUME_API_AUTH_MODE = "api-key";
    expect(resolveConfig().authMode).toBe("x-api-key");
  });

  it("normalizes production API origins to the versioned API base", () => {
    expect(normalizeApiBaseUrl("https://api.sume.com")).toBe(
      "https://api.sume.com/v1",
    );
    expect(normalizeApiBaseUrl("https://api.sume.com/")).toBe(
      "https://api.sume.com/v1",
    );
    expect(normalizeApiBaseUrl("https://api.sume.com/v1/")).toBe(
      "https://api.sume.com/v1",
    );
  });

  it("preserves localhost and custom API base paths", () => {
    expect(normalizeApiBaseUrl("http://127.0.0.1:8787")).toBe(
      "http://127.0.0.1:8787",
    );
    expect(normalizeApiBaseUrl("http://localhost:8787/v1")).toBe(
      "http://localhost:8787/v1",
    );
    expect(normalizeApiBaseUrl("https://example.test/custom")).toBe(
      "https://example.test/custom",
    );
  });

  it("diagnoses unversioned production API base URLs", () => {
    expect(getApiBaseUrlDiagnostic("https://api.sume.com")).toMatchObject({
      code: "production_api_base_url_unversioned",
      configured_base_url: "https://api.sume.com",
      resolved_base_url: "https://api.sume.com/v1",
    });
    expect(getApiBaseUrlDiagnostic("https://api.sume.com/v1")).toBeUndefined();
    expect(getApiBaseUrlDiagnostic("http://127.0.0.1:8787")).toBeUndefined();
  });
});

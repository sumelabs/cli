import { CliError } from "./errors.js";
import { VERSION } from "./version.js";

export type AuthMode = "x-api-key" | "bearer";

export type ApiClientOptions = {
  apiKey?: string;
  authMode?: AuthMode;
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | number | boolean | undefined>;
};

export type UploadOptions = {
  body: Uint8Array;
  headers?: Record<string, string | undefined>;
  url: string;
};

export class SumeClient {
  private readonly apiKey?: string;
  private readonly authMode: AuthMode;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.apiKey = options.apiKey;
    this.authMode = options.authMode ?? "x-api-key";
    this.baseUrl = new URL(options.baseUrl.replace(/\/+$/u, ""));
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(path: string, options: RequestOptions = {}) {
    return this.request("GET", path, options);
  }

  async post(path: string, body: unknown, options: RequestOptions = {}) {
    return this.request("POST", path, { ...options, body });
  }

  async uploadToSignedUrl(options: UploadOptions) {
    const response = await this.fetchImpl(options.url, {
      method: "PUT",
      headers: this.cleanHeaders(options.headers),
      body: options.body,
    });

    if (!response.ok) {
      throw new CliError(`Signed upload failed with HTTP ${response.status}`, {
        code: "signed_upload_failed",
        status: response.status,
      });
    }

    return { ok: true, status: response.status };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions = {},
  ) {
    const url = this.url(path, options.query);
    const response = await this.fetchImpl(url, {
      method,
      headers: this.headers({
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      }),
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    if (!response.ok) {
      const record =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {};
      const error =
        record.error && typeof record.error === "object"
          ? (record.error as Record<string, unknown>)
          : {};
      throw new CliError(
        typeof error.message === "string"
          ? error.message
          : `Request failed with HTTP ${response.status}`,
        {
          code: typeof error.code === "string" ? error.code : "api_error",
          status: response.status,
          requestId:
            typeof record.request_id === "string"
              ? record.request_id
              : undefined,
          details: error.details,
        },
      );
    }

    return body;
  }

  url(pathname: string, query: RequestOptions["query"] = {}) {
    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const url = new URL(this.baseUrl);
    const basePath = url.pathname.replace(/\/+$/u, "");
    url.pathname = `${basePath}${normalizedPath}`;
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  headers(extra: Record<string, string | undefined> = {}) {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `sume-cli/${VERSION}`,
      "X-Sume-Client": "cli",
      "X-Sume-Client-Version": VERSION,
    };
    if (this.apiKey) {
      if (this.authMode === "bearer") {
        headers.Authorization = `Bearer ${this.apiKey}`;
      } else {
        headers["x-api-key"] = this.apiKey;
      }
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) headers[key] = value;
    }
    return headers;
  }

  private cleanHeaders(headers: Record<string, string | undefined> = {}) {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) clean[key] = value;
    }
    return clean;
  }
}

export { SumeClient as SumeApiClient };

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sleep as defaultSleep, networkReason } from "../api/client.ts";
import { CliError, ExitCode } from "./errors.ts";

export const SIGN_IN_SCOPE = "mcp:read mcp:write";
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export interface AuthServer {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  device_authorization_endpoint?: string;
  revocation_endpoint?: string;
}

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export interface SignInTarget {
  server: AuthServer;
  clientId: string;
  resource: string;
}

type Fetch = typeof globalThis.fetch;

export function apiOrigin(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function secureUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  } catch {
    return false;
  }
}

export function clientIdFor(issuer: string): string {
  return `${issuer.replace(/\/+$/u, "")}/oauth/clients/sume-cli`;
}

function signInError(message: string, hint?: string, code = "sign_in_failed"): CliError {
  return new CliError(message, { exitCode: ExitCode.Auth, code, hint });
}

async function getJson(fetch: Fetch, url: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CliError(`Could not reach ${new URL(url).host} (${networkReason(error)}).`, {
      code: "network_error",
      hint: "Check your connection, then run `sume login` again.",
    });
  }
  const body = (await res.json().catch(() => undefined)) as Record<string, unknown> | undefined;
  if (!res.ok || !body || typeof body !== "object") {
    throw signInError(`${new URL(url).host} answered ${res.status} for ${new URL(url).pathname}.`);
  }
  return body;
}

export async function discover(baseUrl: string, fetch: Fetch, signal?: AbortSignal): Promise<SignInTarget> {
  const origin = apiOrigin(baseUrl);
  const resource = await getJson(fetch, `${origin}/.well-known/oauth-protected-resource`, signal).catch(() => {
    throw signInError(
      `${new URL(origin).host} does not offer Sume sign-in.`,
      "Use an API key instead: export SUME_API_KEY, or `sume login --with-key`.",
      "sign_in_unavailable",
    );
  });
  const issuer = (resource.authorization_servers as unknown[] | undefined)?.find((s) => typeof s === "string") as
    | string
    | undefined;
  if (!issuer) throw signInError(`${new URL(origin).host} names no sign-in server.`, undefined, "sign_in_unavailable");
  const meta = await getJson(fetch, `${issuer.replace(/\/+$/u, "")}/.well-known/oauth-authorization-server`, signal);
  const server = meta as unknown as AuthServer;
  if (
    typeof server.issuer !== "string" ||
    server.issuer.replace(/\/+$/u, "") !== issuer.replace(/\/+$/u, "") ||
    !secureUrl(server.issuer) ||
    !secureUrl(server.authorization_endpoint) ||
    !secureUrl(server.token_endpoint) ||
    (server.device_authorization_endpoint !== undefined && !secureUrl(server.device_authorization_endpoint)) ||
    (server.revocation_endpoint !== undefined && !secureUrl(server.revocation_endpoint))
  ) {
    throw signInError(`The sign-in server ${issuer} sent metadata that does not match it, or is not https.`);
  }
  return { server, clientId: clientIdFor(server.issuer), resource: origin };
}

export class OAuthError extends CliError {
  readonly oauthError: string;
  constructor(oauthError: string, description: string | undefined, status: number) {
    super(description || `The sign-in server answered ${status} (${oauthError}).`, {
      exitCode: ExitCode.Auth,
      code: oauthError === "invalid_grant" ? "login_required" : "sign_in_failed",
      hint: oauthError === "invalid_grant" ? "Sign in again: sume login" : undefined,
    });
    this.name = "OAuthError";
    this.oauthError = oauthError;
  }
}

export async function tokenRequest(
  fetch: Fetch,
  endpoint: string,
  form: Record<string, string>,
  signal?: AbortSignal,
): Promise<Tokens> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new CliError(`Could not reach ${new URL(endpoint).host} (${networkReason(error)}).`, {
      code: "network_error",
      hint: "Check your connection and try again.",
    });
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new OAuthError(
      typeof body.error === "string" ? body.error : `http_${res.status}`,
      typeof body.error_description === "string" ? body.error_description : undefined,
      res.status,
    );
  }
  if (typeof body.access_token !== "string" || !body.access_token) {
    throw signInError("The sign-in server answered without an access token.");
  }
  return body as unknown as Tokens;
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

const DONE_PAGE = (ok: boolean, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>Sume CLI</title><body style="font:16px system-ui;margin:4rem auto;max-width:32rem">` +
  `<h1 style="font-size:1.4rem">${ok ? "Signed in to the Sume CLI" : "Sign-in did not finish"}</h1><p>${text}</p></body>`;

export interface BrowserSignIn {
  target: SignInTarget;
  fetch: Fetch;
  openUrl: (url: string) => void | Promise<void>;
  onUrl: (url: string) => void;
  signal: AbortSignal;
  timeoutMs?: number;
}

export async function browserSignIn(options: BrowserSignIn): Promise<Tokens> {
  const { target, fetch, signal } = options;
  const { verifier, challenge } = pkce();
  const state = randomBytes(16).toString("base64url");
  let server: Server | undefined;
  try {
    const result = await new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            signInError(
              "Sign-in timed out: the browser did not come back within 5 minutes.",
              "Run `sume login` again, or `sume login --device` to sign in with a code.",
              "sign_in_timeout",
            ),
          ),
        options.timeoutMs ?? 300_000,
      );
      const stop = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
      };
      const onAbort = () => stop(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const finish = (ok: boolean, text: string, outcome: () => void) => {
          res.writeHead(ok ? 200 : 400, { "content-type": "text/html; charset=utf-8" }).end(DONE_PAGE(ok, text));
          outcome();
        };
        if (url.searchParams.get("state") !== state) {
          finish(false, "This sign-in link is not the one the CLI started. Run sume login again.", () =>
            stop(signInError("The sign-in answer did not match the request (state).", "Run `sume login` again.")),
          );
          return;
        }
        const iss = url.searchParams.get("iss");
        if (iss && iss.replace(/\/+$/u, "") !== target.server.issuer.replace(/\/+$/u, "")) {
          finish(false, "This answer came from another sign-in server. Run sume login again.", () =>
            stop(signInError(`The sign-in answer came from ${iss}, not ${target.server.issuer}.`)),
          );
          return;
        }
        const denied = url.searchParams.get("error");
        if (denied) {
          const why = url.searchParams.get("error_description") ?? denied;
          finish(false, "Nothing was signed in. You can close this tab.", () =>
            stop(signInError(`Sign-in was not allowed: ${why}.`, "Run `sume login` again to retry.", "sign_in_denied")),
          );
          return;
        }
        const code = url.searchParams.get("code");
        if (!code) {
          finish(false, "The answer had no code. Run sume login again.", () =>
            stop(signInError("The sign-in answer had no code.")),
          );
          return;
        }
        const address = server?.address() as AddressInfo;
        finish(true, "You can close this tab and go back to the terminal.", () => {
          stop();
          resolve({ code, redirectUri: `http://127.0.0.1:${address.port}/callback` });
        });
      });
      server.on("error", (error) => stop(error));
      const listening = server;
      listening.listen(0, "127.0.0.1", () => {
        const { port } = listening.address() as AddressInfo;
        const url = new URL(target.server.authorization_endpoint);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", target.clientId);
        url.searchParams.set("redirect_uri", `http://127.0.0.1:${port}/callback`);
        url.searchParams.set("scope", SIGN_IN_SCOPE);
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("resource", target.resource);
        options.onUrl(url.toString());
        Promise.resolve(options.openUrl(url.toString())).catch(() => {});
      });
    });
    return await tokenRequest(
      fetch,
      target.server.token_endpoint,
      {
        grant_type: "authorization_code",
        code: result.code,
        redirect_uri: result.redirectUri,
        client_id: target.clientId,
        code_verifier: verifier,
        resource: target.resource,
      },
      signal,
    );
  } finally {
    server?.closeAllConnections?.();
    server?.close();
  }
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface DeviceSignIn {
  target: SignInTarget;
  fetch: Fetch;
  onCode: (code: DeviceCode) => void;
  signal: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function deviceSignIn(options: DeviceSignIn): Promise<Tokens> {
  const { target, fetch, signal } = options;
  const endpoint = target.server.device_authorization_endpoint;
  if (!endpoint) {
    throw signInError(
      `${new URL(target.server.issuer).host} does not offer sign-in with a code.`,
      "Sign in in a browser with `sume login`, or use an API key.",
      "sign_in_unavailable",
    );
  }
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        client_id: target.clientId,
        scope: SIGN_IN_SCOPE,
        resource: target.resource,
      }).toString(),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CliError(`Could not reach ${new URL(endpoint).host} (${networkReason(error)}).`, {
      code: "network_error",
    });
  }
  const code = (await res.json().catch(() => ({}))) as DeviceCode & { error?: string; error_description?: string };
  if (!res.ok || typeof code.device_code !== "string") {
    throw signInError(code.error_description ?? `The sign-in server answered ${res.status}.`);
  }
  options.onCode(code);
  const sleep = options.sleep ?? defaultSleep;
  let interval = Math.max(code.interval ?? 5, 1);
  const deadline = Date.now() + Math.min(code.expires_in, 900) * 1000;
  for (;;) {
    await sleep(interval * 1000, signal);
    try {
      return await tokenRequest(
        fetch,
        target.server.token_endpoint,
        {
          grant_type: DEVICE_GRANT,
          device_code: code.device_code,
          client_id: target.clientId,
          resource: target.resource,
        },
        signal,
      );
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (error.oauthError === "authorization_pending" && Date.now() < deadline) continue;
      if (error.oauthError === "slow_down" && Date.now() < deadline) {
        interval += 5;
        continue;
      }
      if (error.oauthError === "access_denied") {
        throw signInError(
          "Sign-in was not allowed on the other device.",
          "Run `sume login --device` to try again.",
          "sign_in_denied",
        );
      }
      if (error.oauthError === "expired_token" || error.oauthError === "authorization_pending") {
        throw signInError(
          "The sign-in code expired before it was approved.",
          "Run `sume login --device` for a new code.",
          "sign_in_timeout",
        );
      }
      throw error;
    }
  }
}

export async function revoke(
  fetch: Fetch,
  endpoint: string | undefined,
  clientId: string,
  token: string,
  hint: "refresh_token" | "access_token",
): Promise<boolean> {
  if (!endpoint) return false;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: hint, client_id: clientId }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    await res.arrayBuffer().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}

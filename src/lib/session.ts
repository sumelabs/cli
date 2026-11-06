import { open, rm, stat } from "node:fs/promises";
import { sleep as defaultSleep } from "../api/client.ts";
import { readConfig, type StoredSession, writeConfig } from "./config.ts";
import { CliError, ExitCode } from "./errors.ts";
import { OAuthError, type Tokens, tokenRequest } from "./oauth.ts";

const EARLY_MS = 60_000;
const LOCK_STALE_MS = 30_000;

export function sessionFrom(
  tokens: Tokens,
  base: Pick<StoredSession, "issuer" | "client_id" | "resource" | "token_endpoint" | "revocation_endpoint">,
  previous?: StoredSession,
  now = Date.now(),
): StoredSession {
  const refresh = tokens.refresh_token ?? previous?.refresh_token;
  const scope = tokens.scope ?? previous?.scope;
  return {
    issuer: base.issuer,
    client_id: base.client_id,
    resource: base.resource,
    token_endpoint: base.token_endpoint,
    ...(base.revocation_endpoint ? { revocation_endpoint: base.revocation_endpoint } : {}),
    access_token: tokens.access_token,
    ...(refresh ? { refresh_token: refresh } : {}),
    expires_at: new Date(now + Math.max(tokens.expires_in ?? 3600, 0) * 1000).toISOString(),
    ...(scope ? { scope } : {}),
  };
}

export function loginRequired(message: string): CliError {
  return new CliError(message, { exitCode: ExitCode.Auth, code: "login_required", hint: "Sign in again: sume login" });
}

async function withLock<T>(configPath: string, work: () => Promise<T>, sleep = defaultSleep): Promise<T> {
  const lock = `${configPath}.lock`;
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(lock).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(lock, { force: true });
        continue;
      }
      if (attempt > 300) {
        throw new CliError("Another sume command is refreshing the sign-in and has not finished.", {
          code: "sign_in_busy",
          hint: `If no other sume is running, delete ${lock} and try again.`,
        });
      }
      await sleep(100);
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { force: true });
  }
}

export class SessionCredential {
  #session: StoredSession;
  readonly #configPath: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #now: () => number;

  constructor(options: {
    session: StoredSession;
    configPath: string;
    fetch?: typeof globalThis.fetch;
    now?: () => number;
  }) {
    this.#session = options.session;
    this.#configPath = options.configPath;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
  }

  get session(): StoredSession {
    return this.#session;
  }

  async token(signal?: AbortSignal): Promise<string> {
    if (Date.parse(this.#session.expires_at) - EARLY_MS > this.#now()) return this.#session.access_token;
    return this.#refresh(this.#session.access_token, signal);
  }

  async refreshAfterRejection(rejected: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.#session.refresh_token) return undefined;
    return this.#refresh(rejected, signal);
  }

  async #refresh(stale: string, signal?: AbortSignal): Promise<string> {
    return withLock(this.#configPath, async () => {
      const stored = readConfig(this.#configPath);
      const current = stored.session;
      if (!current || current.resource !== this.#session.resource) {
        throw loginRequired("The Sume sign-in on this computer ended (signed out in another terminal).");
      }
      if (current.access_token !== stale && Date.parse(current.expires_at) - EARLY_MS > this.#now()) {
        this.#session = current;
        return current.access_token;
      }
      if (!current.refresh_token) throw loginRequired("The Sume sign-in expired.");
      let tokens: Tokens;
      try {
        tokens = await tokenRequest(
          this.#fetch,
          current.token_endpoint,
          {
            grant_type: "refresh_token",
            refresh_token: current.refresh_token,
            client_id: current.client_id,
            resource: current.resource,
          },
          signal,
        );
      } catch (error) {
        if (
          error instanceof OAuthError &&
          (error.oauthError === "invalid_grant" || error.oauthError === "invalid_token")
        ) {
          const { session: _ended, ...rest } = stored;
          writeConfig(this.#configPath, rest);
          throw loginRequired("The Sume sign-in expired or was revoked.");
        }
        throw error;
      }
      const next = sessionFrom(tokens, current, current, this.#now());
      writeConfig(this.#configPath, { ...stored, session: next });
      this.#session = next;
      return next.access_token;
    });
  }
}

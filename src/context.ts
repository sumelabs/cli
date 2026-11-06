import { spawn } from "node:child_process";
import { sleep as defaultSleep, SumeClient } from "./api/client.ts";
import type { Settings } from "./lib/config.ts";
import { SessionCredential } from "./lib/session.ts";
import type { Ui } from "./lib/ui.ts";
import { VERSION } from "./version.ts";

/** What every command receives besides its parsed arguments. */
export interface Context {
  ui: Ui;
  /** `--json`: one JSON document on stdout, nothing else. */
  json: boolean;
  settings: Settings;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Aborted on Ctrl-C. Pass it to anything that waits. */
  signal: AbortSignal;
  userAgent: string;
  /** Every wait goes through this, so tests can skip the clock. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The job this command is following, so an error or interrupt can name it. */
  jobId: string | undefined;
  /** The Idempotency-Key of a submit in flight, for the same reason. */
  idempotencyKey: string | undefined;
  /** For calls outside the API (GitHub, the media host), so tests can stand in for them. */
  fetch: typeof globalThis.fetch;
  openUrl: (url: string) => void | Promise<void>;
  canOpenBrowser: boolean;
  client(): SumeClient;
}

export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args as string[], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

export function browserAvailable(env: NodeJS.ProcessEnv): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY || env.CI) return false;
  if (process.platform === "linux") return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  return true;
}

export function userAgent(): string {
  return `sume-cli/${VERSION} (node ${process.versions.node}; ${process.platform} ${process.arch})`;
}

export function createContext(options: {
  ui: Ui;
  json: boolean;
  settings: Settings;
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  openUrl?: (url: string) => void | Promise<void>;
}): Context {
  const agent = userAgent();
  const sleep = options.sleep ?? defaultSleep;
  let client: SumeClient | undefined;
  const credential = options.settings.session
    ? new SessionCredential({
        session: options.settings.session,
        configPath: options.settings.configPath,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      })
    : undefined;
  return {
    ui: options.ui,
    json: options.json,
    settings: options.settings,
    cwd: options.cwd,
    env: options.env,
    signal: options.signal,
    userAgent: agent,
    sleep,
    jobId: undefined,
    idempotencyKey: undefined,
    fetch: options.fetch ?? globalThis.fetch,
    openUrl: options.openUrl ?? openInBrowser,
    canOpenBrowser: options.openUrl !== undefined || browserAvailable(options.env),
    client() {
      client ??= new SumeClient({
        baseUrl: options.settings.baseUrl,
        apiKey: options.settings.apiKey,
        credential,
        userAgent: agent,
        sleep,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        onResponse: ({ method, url, status, requestId, ms, attempt }) => {
          const path = new URL(url).pathname;
          options.ui.debug(
            `${method} ${path} → ${status} ${ms}ms${requestId ? ` ${requestId}` : ""}${attempt > 1 ? ` (attempt ${attempt})` : ""}`,
          );
        },
      });
      return client;
    },
  };
}

import { hostname } from "node:os";
import { Command } from "commander";
import {
  clearConfig,
  DEFAULT_AUTH_MODE,
  DEFAULT_API_BASE_URL,
  getApiBaseUrlDiagnostic,
  normalizeAuthMode,
  normalizeApiBaseUrl,
  configPath,
  readConfig,
  redactApiKey,
  resolveConfig,
  resolveAppBaseUrl,
  writeConfig,
} from "../lib/config.js";
import { openBrowser } from "../lib/browser.js";
import {
  pollCliLogin,
  startCliLogin,
  type CliLoginPollResponse,
} from "../lib/login-client.js";
import { renderResult } from "../lib/render.js";
import { showSubcommandHelp } from "../lib/command.js";
import {
  command as formatCommand,
  field,
  info,
  ok,
  section,
  warn,
} from "../lib/ui.js";
import { CliError } from "../lib/errors.js";

type GlobalOptions = { json?: boolean };

const REMOTE_LOGIN_COMMAND = "sume login --no-browser --timeout 600";

function positiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError("Expected a positive integer.", {
      code: "invalid_argument",
    });
  }
  return parsed;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLogin({
  appBaseUrl,
  deviceCode,
  initialIntervalSeconds,
  timeoutSeconds,
  json,
}: {
  appBaseUrl: string;
  deviceCode: string;
  initialIntervalSeconds: number;
  timeoutSeconds: number;
  json: boolean;
}) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let intervalMs = Math.max(1000, initialIntervalSeconds * 1000);
  let last: CliLoginPollResponse | null = null;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    last = await pollCliLogin({ appBaseUrl, deviceCode });

    if (last.status === "approved") return last;
    if (
      last.status === "denied" ||
      last.status === "expired" ||
      last.status === "consumed"
    ) {
      throw new CliError(`CLI login ${last.status}.`, {
        code: `login_${last.status}`,
      });
    }

    if (!json) {
      process.stderr.write(`${info(`Waiting for browser approval (${last.status})`)}\n`);
    }
    intervalMs = Math.max(1000, (last.interval ?? 3) * 1000);
  }

  throw new CliError("Timed out waiting for browser approval.", {
    code: "login_timeout",
    details: last,
  });
}

export function registerAuthCommands(program: Command) {
  const auth = program
    .command("auth")
    .description("Configure Sume API authentication.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "status" }),
    );

  auth
    .command("setup")
    .description("Save a local Sume API key and optional API base URL.")
    .requiredOption("--api-key <key>", "Sume API key.")
    .option("--base-url <url>", "API base URL override.")
    .option("--app-url <url>", "Dashboard app URL override for browser login.")
    .option(
      "--auth-mode <mode>",
      "API key header mode: x-api-key or bearer.",
    )
    .action(
      (options: {
        apiKey: string;
        baseUrl?: string;
        appUrl?: string;
        authMode?: string;
      }) => {
        const current = readConfig();
        const authMode = options.authMode
          ? normalizeAuthMode(options.authMode)
          : current.authMode;
        const baseUrl = options.baseUrl ?? current.baseUrl;
        const appBaseUrl = options.appUrl ?? current.appBaseUrl;
        writeConfig({
          ...current,
          apiKey: options.apiKey,
          authMode,
          baseUrl,
          appBaseUrl,
        });
        const savedBaseUrl = baseUrl ? normalizeApiBaseUrl(baseUrl) : undefined;
        const savedAppBaseUrl = appBaseUrl
          ? resolveAppBaseUrl(appBaseUrl, savedBaseUrl ?? DEFAULT_API_BASE_URL)
          : undefined;
        renderResult(
          {
            ok: true,
            auth_mode: authMode ?? DEFAULT_AUTH_MODE,
            base_url: savedBaseUrl,
            app_base_url: savedAppBaseUrl,
          },
          {
            json: Boolean(program.optsWithGlobals<GlobalOptions>().json),
            human: [ok("Saved Sume API configuration.")],
          },
        );
      },
    );

  auth
    .command("status")
    .description("Show local Sume API authentication status.")
    .action(() => {
      const config = readConfig();
      const resolved = resolveConfig();
      const configuredBaseUrl = process.env.SUME_API_BASE_URL ?? config.baseUrl;
      const apiWarning = getApiBaseUrlDiagnostic(configuredBaseUrl);
      renderResult(
        {
          configured: Boolean(resolved.apiKey),
          api_key: redactApiKey(resolved.apiKey),
          auth_mode: resolved.authMode ?? DEFAULT_AUTH_MODE,
          base_url: resolved.baseUrl,
          configured_base_url: configuredBaseUrl,
          app_base_url: resolved.appBaseUrl,
          warnings: apiWarning ? [apiWarning] : [],
        },
        {
          json: Boolean(program.optsWithGlobals<GlobalOptions>().json),
          human: [
            ["API key", redactApiKey(resolved.apiKey)],
            ["Auth mode", resolved.authMode ?? DEFAULT_AUTH_MODE],
            ["Base URL", resolved.baseUrl],
            ["App URL", resolved.appBaseUrl],
            ...(apiWarning ? [warn(apiWarning.message)] : []),
          ],
        },
      );
    });

  auth
    .command("logout")
    .description("Remove local Sume API authentication.")
    .action(() => {
      clearConfig();
      renderResult(
        { ok: true },
        {
          json: Boolean(program.optsWithGlobals<GlobalOptions>().json),
          human: [ok("Removed local Sume API configuration.")],
        },
      );
    });

  program
    .command("login")
    .description("Authorize Sume CLI through browser or remote device approval.")
    .option("--api-key <key>", "Sume API key.")
    .option("--base-url <url>", "API base URL override.")
    .option("--app-url <url>", "Dashboard app URL override.")
    .option("--no-browser", "Print the login URL instead of opening a browser.")
    .option("--device", "Alias for --no-browser for remote/headless terminals.")
    .option(
      "--device-auth",
      "Alias for --no-browser for remote/headless terminals.",
    )
    .option("--timeout <seconds>", "Seconds to wait for approval.", "600")
    .option("--device-label <label>", "Device label shown in the browser.")
    .option(
      "--auth-mode <mode>",
      "API key header mode: x-api-key or bearer.",
    )
    .action(async (options: {
      apiKey?: string;
      baseUrl?: string;
      appUrl?: string;
      noBrowser?: boolean;
      device?: boolean;
      deviceAuth?: boolean;
      timeout?: string;
      deviceLabel?: string;
      authMode?: string;
    }) => {
      const current = readConfig();
      const resolved = resolveConfig();
      const authMode = options.authMode
        ? normalizeAuthMode(options.authMode)
        : current.authMode ?? resolved.authMode;
      const baseUrl = normalizeApiBaseUrl(
        options.baseUrl ?? current.baseUrl ?? resolved.baseUrl,
      );
      const appBaseUrl = resolveAppBaseUrl(
        options.appUrl ?? current.appBaseUrl ?? resolved.appBaseUrl,
        baseUrl,
      );
      const json = Boolean(program.optsWithGlobals<GlobalOptions>().json);

      if (!options.apiKey) {
        const started = await startCliLogin({
          appBaseUrl,
          deviceLabel: options.deviceLabel?.trim() || hostname(),
        });
        const shouldOpenBrowser =
          !options.noBrowser && !options.device && !options.deviceAuth;
        const opened = shouldOpenBrowser
          ? await openBrowser(started.verification_uri_complete)
          : false;

        if (!json) {
          process.stdout.write(
            [
              section("Browser Login"),
              field("URL", started.verification_uri_complete),
              field("Code", started.user_code),
              field("Expires in", `${started.expires_in}s`),
              shouldOpenBrowser
                ? opened
                  ? ok("Browser opened.")
                  : [
                      info("Browser open failed."),
                      `Remote/headless terminal? Use ${formatCommand(
                        REMOTE_LOGIN_COMMAND,
                      )}.`,
                    ].join("\n")
                : null,
            ]
              .filter(Boolean)
              .join("\n") + "\n",
          );
          process.stderr.write(`${info("Waiting for browser approval")}\n`);
        }

        const approved = await waitForLogin({
          appBaseUrl,
          deviceCode: started.device_code,
          initialIntervalSeconds: started.interval,
          timeoutSeconds: Math.min(
            positiveInteger(options.timeout, 600),
            started.expires_in,
          ),
          json,
        });

        writeConfig({
          ...current,
          apiKey: approved.api_key.key,
          authMode: authMode ?? DEFAULT_AUTH_MODE,
          baseUrl,
          appBaseUrl,
        });

        renderResult(
          {
            object: "login",
            status: "authenticated",
            config_file: configPath(),
            api_base_url: baseUrl,
            app_base_url: appBaseUrl,
            api_key: {
              id: approved.api_key.id,
              prefix: approved.api_key.key_prefix,
              scopes: approved.api_key.scopes,
              key: redactApiKey(approved.api_key.key),
            },
          },
          {
            json,
            human: [
              ok("Login complete."),
              field("API key", redactApiKey(approved.api_key.key)),
            ],
          },
        );
        return;
      }

      writeConfig({
        ...current,
        apiKey: options.apiKey,
        authMode,
        baseUrl,
        appBaseUrl,
      });
      renderResult(
        { ok: true },
        {
          json: Boolean(program.optsWithGlobals<GlobalOptions>().json),
          human: [ok("Saved Sume API configuration.")],
        },
      );
    });

  program
    .command("logout")
    .description("Remove local Sume API authentication.")
    .action(() => {
      clearConfig();
      renderResult(
        { ok: true },
        {
          json: Boolean(program.optsWithGlobals<GlobalOptions>().json),
          human: [ok("Removed local Sume API configuration.")],
        },
      );
    });
}

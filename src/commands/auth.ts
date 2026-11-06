import type { Balance, Workspace } from "../api/types.ts";
import type { CommandSpec } from "../lib/args.ts";
import { KEYS_URL, maskKey, readConfig, writeConfig } from "../lib/config.ts";
import { ExitCode, UsageError } from "../lib/errors.ts";
import { readAllStdin, readSecret } from "../lib/prompt.ts";
import { balanceLine, balanceSummary, currentWorkspace, workspaceLabel } from "./account.ts";
import { checkKey, checkSession } from "./key-check.ts";
import { logoutCommand, token } from "./login.ts";

const login: CommandSpec = {
  name: "login",
  summary: "Save an API key for this computer",
  description:
    `Checks the key against the API, then stores it in the config file, readable by you only. ` +
    `Create a key at ${KEYS_URL}. SUME_API_KEY, when set, still wins over the saved key.`,
  flags: [{ name: "with-key", type: "boolean", description: "Read the key from stdin instead of prompting" }],
  examples: ["sume auth login", "printenv SUME_API_KEY | sume auth login --with-key"],
  run: async (parsed, ctx) => {
    const { ui } = ctx;
    let key: string;
    if (parsed.flags["with-key"] === true) {
      if (process.stdin.isTTY) {
        throw new UsageError(
          "--with-key reads the key from stdin, but stdin is a terminal.",
          "Pipe it in: printenv SUME_API_KEY | sume auth login --with-key",
        );
      }
      key = (await readAllStdin()).trim();
    } else {
      ui.info(`Create a key at ${ui.c.cyan(KEYS_URL)}, then paste it here.`);
      key = await readSecret("API key: ");
    }
    if (!key) throw new UsageError("No key given.");
    if (/\s/u.test(key)) throw new UsageError("That does not look like an API key: it contains spaces.");

    const verdict = await checkKey(ctx, key);
    if (!verdict.ok) throw verdict.error;

    const stored = readConfig(ctx.settings.configPath);
    const baseUrl = ctx.settings.baseUrlSource === "flag" ? ctx.settings.baseUrl : stored.base_url;
    writeConfig(ctx.settings.configPath, { ...stored, api_key: key, ...(baseUrl ? { base_url: baseUrl } : {}) });
    if (ctx.json) {
      ui.json({ saved: true, key: maskKey(key), config_path: ctx.settings.configPath });
    } else {
      ui.success(`Saved ${maskKey(key)} to ${ctx.settings.configPath}`);
      if (ctx.env.SUME_API_KEY) ui.warn("SUME_API_KEY is set in this shell; it is used before the saved key.");
    }
    return ExitCode.Ok;
  },
};

const status: CommandSpec = {
  name: "status",
  summary: "Show which key and API the CLI uses, and check the key works",
  run: async (_parsed, ctx) => {
    const { ui } = ctx;
    const { apiKey, apiKeySource, baseUrlSource, configPath, session, sessionElsewhere } = ctx.settings;
    const sources = { flag: "--api-key", env: "SUME_API_KEY", dotenv: "SUME_API_KEY in ./.env", config: configPath };
    const verdict = apiKey ? await checkKey(ctx, apiKey) : session ? await checkSession(ctx) : undefined;
    const elsewhere =
      !apiKey && !session && sessionElsewhere
        ? `This computer is signed in for ${sessionElsewhere}, not ${ctx.client().baseUrl}. Sign in here with: sume login --base-url ${ctx.client().baseUrl}`
        : undefined;
    let workspace: Workspace | undefined;
    let funds: Balance | undefined;
    if (verdict?.ok) {
      [workspace, funds] = await Promise.all([
        currentWorkspace(ctx),
        ctx
          .client()
          .getBalance(ctx.signal)
          .catch(() => undefined),
      ]);
    }

    if (ctx.json) {
      ui.json({
        api_url: ctx.client().baseUrl,
        api_url_source: baseUrlSource,
        key: apiKey ? maskKey(apiKey) : null,
        key_source: apiKeySource ?? (session ? "session" : null),
        valid: verdict?.ok ?? false,
        signed_in: Boolean(session),
        session: session
          ? {
              issuer: session.issuer,
              resource: session.resource,
              expires_at: session.expires_at,
              scope: session.scope ?? null,
            }
          : null,
        ...(elsewhere ? { hint: elsewhere } : {}),
        ...(verdict && !verdict.ok
          ? { error: { code: verdict.error.code, message: verdict.error.message, hint: verdict.error.hint ?? null } }
          : {}),
        ...(verdict?.ok
          ? {
              workspace: workspace ? { id: workspace.id, name: workspace.name, kind: workspace.kind } : null,
              balance: funds ? balanceSummary(funds) : null,
            }
          : {}),
      });
    } else {
      const { c } = ui;
      ui.out(
        `${c.dim("API".padEnd(10))}${ctx.client().baseUrl} ${c.dim(baseUrlSource === "default" ? "(default)" : `(from ${baseUrlSource})`)}`,
      );
      if (!apiKey && !session) {
        ui.out(`${c.dim("Key".padEnd(10))}${c.yellow("none")}`);
        ui.info(
          c.dim(
            `\n${elsewhere ?? `Sign in with \`sume login\`, or make a key at ${KEYS_URL} and export SUME_API_KEY.`}`,
          ),
        );
      } else {
        ui.out(
          apiKey
            ? `${c.dim("Key".padEnd(10))}${maskKey(apiKey)} ${c.dim(`(from ${apiKeySource ? sources[apiKeySource] : "?"})`)}`
            : `${c.dim("Key".padEnd(10))}Sume sign-in ${c.dim(`(${new URL(session?.issuer ?? "").host}; refreshes on its own)`)}`,
        );
        ui.out(
          `${c.dim("Check".padEnd(10))}${verdict?.ok ? c.green("ok") : c.red(verdict?.error.message ?? "failed")}`,
        );
        if (verdict?.ok) {
          ui.out(
            `${c.dim("Workspace".padEnd(10))}${workspace ? `${workspaceLabel(workspace)} ${c.dim(workspace.id)}` : "—"}`,
          );
          if (funds) ui.out(`${c.dim("Balance".padEnd(10))}${balanceLine(funds)}`);
        }
        if (verdict && !verdict.ok && verdict.error.hint) ui.info(c.dim(`\n${verdict.error.hint}`));
      }
    }
    if (!apiKey && !session) return ExitCode.Auth;
    return verdict?.ok ? ExitCode.Ok : (verdict?.error.exitCode ?? ExitCode.Error);
  },
};

const logout: CommandSpec = {
  name: "logout",
  summary: "Forget the saved key, and revoke a Sume sign-in",
  description: `Removes the saved key from this computer (revoke the key itself at ${KEYS_URL}). A Sume sign-in is revoked on the server, then removed. Same as \`sume logout\`.`,
  run: async (_parsed, ctx) => logoutCommand(ctx),
};

export const auth: CommandSpec = {
  name: "auth",
  group: "Setup",
  summary: "Save, check or forget your API key or Sume sign-in",
  commands: [login, status, logout, token],
};

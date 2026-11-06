import { SumeClient } from "../api/client.ts";
import { ApiError } from "../api/errors.ts";
import type { Workspace, WorkspaceList } from "../api/types.ts";
import type { Context } from "../context.ts";
import type { CommandSpec } from "../lib/args.ts";
import { maskKey, readConfig, removeConfig, type StoredConfig, writeConfig } from "../lib/config.ts";
import { CliError, ExitCode, UsageError } from "../lib/errors.ts";
import { browserSignIn, deviceSignIn, discover, revoke, type SignInTarget, type Tokens } from "../lib/oauth.ts";
import { readAllStdin } from "../lib/prompt.ts";
import { loginRequired, SessionCredential, sessionFrom } from "../lib/session.ts";
import { selectedWorkspace, workspaceLabel } from "./account.ts";
import { checkKey } from "./key-check.ts";

export const login: CommandSpec = {
  name: "login",
  group: "Setup",
  summary: "Sign in with Sume (browser or code), or save an API key",
  description:
    "Signs this computer in with the same Sume sign-in as the hosted MCP: a browser opens, you choose Allow, and " +
    "the CLI keeps a one-hour access token that refreshes on its own. With no browser here (SSH, CI, an agent), " +
    "--device prints a code to approve on any device. A sign-in can switch workspaces (`sume workspaces select`). " +
    "Scripts can keep using an API key: --with-key saves one from stdin, and SUME_API_KEY always wins.",
  flags: [
    { name: "device", type: "boolean", description: "Sign in with a code approved on another device" },
    { name: "no-open", type: "boolean", description: "Print the sign-in URL instead of opening a browser" },
    { name: "with-key", type: "boolean", description: "Save an API key read from stdin instead of signing in" },
  ],
  examples: [
    "sume login",
    "sume login --device",
    "printenv SUME_API_KEY | sume login --with-key",
    "sume login --api-key <KEY>",
  ],
  run: async (parsed, ctx) => {
    const keyFlag = parsed.flags["api-key"] as string | undefined;
    if (parsed.flags["with-key"] === true || keyFlag !== undefined) return saveKey(ctx, keyFlag);
    return signIn(ctx, { device: parsed.flags.device === true, open: parsed.flags["no-open"] !== true });
  },
};

async function saveKey(ctx: Context, fromFlag: string | undefined): Promise<number> {
  const { ui } = ctx;
  let key = fromFlag?.trim();
  if (key === undefined) {
    if (process.stdin.isTTY) {
      throw new UsageError(
        "--with-key reads the key from stdin, but stdin is a terminal.",
        "Pipe it in: printenv SUME_API_KEY | sume login --with-key",
      );
    }
    key = (await readAllStdin()).trim();
  }
  if (!key) throw new UsageError("No key given.");
  if (/\s/u.test(key)) throw new UsageError("That does not look like an API key: it contains spaces.");
  const verdict = await checkKey(ctx, key);
  if (!verdict.ok) throw verdict.error;
  const stored = readConfig(ctx.settings.configPath);
  await endSession(ctx, stored);
  const { session: _replaced, ...rest } = stored;
  const baseUrl = ctx.settings.baseUrlSource === "flag" ? ctx.settings.baseUrl : stored.base_url;
  writeConfig(ctx.settings.configPath, { ...rest, api_key: key, ...(baseUrl ? { base_url: baseUrl } : {}) });
  if (ctx.json) {
    ui.json({ saved: true, key: maskKey(key), config_path: ctx.settings.configPath });
  } else {
    ui.success(`Saved ${maskKey(key)} to ${ctx.settings.configPath}`);
    if (fromFlag !== undefined) {
      ui.warn(
        "A key on the command line can stay in your shell history. `… | sume login --with-key` reads it from stdin.",
      );
    }
    if (ctx.env.SUME_API_KEY) ui.warn("SUME_API_KEY is set in this shell; it is used before the saved key.");
  }
  return ExitCode.Ok;
}

async function signIn(ctx: Context, options: { device: boolean; open: boolean }): Promise<number> {
  const { ui } = ctx;
  const baseUrl = ctx.client().baseUrl;
  ui.spin("Finding the sign-in server");
  const target = await discover(baseUrl, ctx.fetch, ctx.signal);
  ui.stopSpinner();
  const useDevice = options.device || !ui.options.interactive;
  let tokens: Tokens;
  if (useDevice) {
    tokens = await deviceSignIn({
      target,
      fetch: ctx.fetch,
      signal: ctx.signal,
      sleep: ctx.sleep,
      onCode: (code) => {
        const url = code.verification_uri_complete ?? code.verification_uri;
        const write = (line: string) => ui.options.stderr.write(`${line}\n`);
        write(`To sign in, open ${url}`);
        write(
          `and confirm the code ${code.user_code}. Waiting for approval (the code works for ${Math.round(code.expires_in / 60)} minutes)…`,
        );
      },
    });
  } else {
    tokens = await browserSignIn({
      target,
      fetch: ctx.fetch,
      signal: ctx.signal,
      openUrl: options.open && ctx.canOpenBrowser ? ctx.openUrl : () => {},
      onUrl: (url) => {
        ui.info(
          options.open && ctx.canOpenBrowser
            ? "Opening the browser to sign in. If it does not open, visit:"
            : "To sign in, open:",
        );
        ui.info(`  ${url}`);
        ui.spin("Waiting for the browser");
      },
    });
    ui.stopSpinner();
  }
  return finishSignIn(ctx, target, tokens);
}

async function finishSignIn(ctx: Context, target: SignInTarget, tokens: Tokens): Promise<number> {
  const { ui } = ctx;
  const session = sessionFrom(tokens, {
    issuer: target.server.issuer,
    client_id: target.clientId,
    resource: target.resource,
    token_endpoint: target.server.token_endpoint,
    ...(target.server.revocation_endpoint ? { revocation_endpoint: target.server.revocation_endpoint } : {}),
  });
  const stored = readConfig(ctx.settings.configPath);
  const { api_key: _replacedKey, session: previous, ...rest } = stored;
  const baseUrl = ctx.settings.baseUrlSource === "flag" ? ctx.settings.baseUrl : stored.base_url;
  writeConfig(ctx.settings.configPath, { ...rest, session, ...(baseUrl ? { base_url: baseUrl } : {}) });
  if (previous && previous.refresh_token !== session.refresh_token) await endSession(ctx, { session: previous });

  const client = new SumeClient({
    baseUrl: ctx.settings.baseUrl,
    apiKey: session.access_token,
    userAgent: ctx.userAgent,
  });
  const workspaces = await client.listWorkspaces(ctx.signal).catch(() => undefined);
  const workspace = selectedWorkspace(workspaces);
  if (ctx.json) {
    ui.json({
      signed_in: true,
      workspace: workspace ? { id: workspace.id, name: workspace.name, kind: workspace.kind } : null,
      switchable: workspaces?.switchable ?? null,
      scope: session.scope ?? null,
      expires_at: session.expires_at,
      config_path: ctx.settings.configPath,
    });
    return ExitCode.Ok;
  }
  ui.success(`Signed in to Sume${workspace ? `, working in ${workspaceLabel(workspace)}` : ""}.`);
  if (workspaces && workspaces.data.length > 1) {
    ui.info(ui.c.dim(`${workspaces.data.length} workspaces. Switch with: sume workspaces select <WORKSPACE>`));
  }
  if (ctx.env.SUME_API_KEY) ui.warn("SUME_API_KEY is set in this shell; it is used before the sign-in.");
  return ExitCode.Ok;
}

async function endSession(ctx: Context, stored: Pick<StoredConfig, "session">): Promise<boolean | null> {
  const session = stored.session;
  if (!session) return null;
  const viaRefresh = session.refresh_token
    ? await revoke(ctx.fetch, session.revocation_endpoint, session.client_id, session.refresh_token, "refresh_token")
    : false;
  const viaAccess = await revoke(
    ctx.fetch,
    session.revocation_endpoint,
    session.client_id,
    session.access_token,
    "access_token",
  );
  return viaRefresh || viaAccess;
}

export async function logoutCommand(ctx: Context): Promise<number> {
  const { ui } = ctx;
  const stored = readConfig(ctx.settings.configPath);
  const hadKey = Boolean(stored.api_key);
  const hadSession = Boolean(stored.session);
  const revoked = await endSession(ctx, stored);
  if (stored.base_url) writeConfig(ctx.settings.configPath, { base_url: stored.base_url });
  else removeConfig(ctx.settings.configPath);
  if (ctx.json) {
    ui.json({ removed: hadKey || hadSession, revoked, signed_out: hadSession });
  } else {
    if (hadSession) {
      ui.success(
        revoked
          ? "Signed out: the Sume sign-in is revoked and removed from this computer."
          : "Signed out on this computer. The sign-in server did not confirm the revoke; it ends when its tokens expire.",
      );
    }
    if (hadKey)
      ui.success("Removed the saved key. It still works until you revoke it at sume.com → Settings → API keys.");
    if (!hadKey && !hadSession) ui.success("No saved key or sign-in.");
    if (ctx.env.SUME_API_KEY) ui.warn("SUME_API_KEY is still set in this shell.");
  }
  return ExitCode.Ok;
}

export const logout: CommandSpec = {
  name: "logout",
  group: "Setup",
  summary: "Sign out: revoke the Sume sign-in and forget the saved key",
  description:
    "Revokes the Sume sign-in on the server, then removes it and any saved key from this computer. A saved API key " +
    "keeps working elsewhere until you revoke it at sume.com → Settings → API keys.",
  run: async (_parsed, ctx) => logoutCommand(ctx),
};

export const token: CommandSpec = {
  name: "token",
  summary: "Print the sign-in's current access token, for a script that calls the API itself",
  description:
    "Prints a valid access token for the Sume sign-in, refreshing it first when it is close to expiring. It lasts " +
    "about an hour; run this again for a new one. With an API key there is no token: use the key.",
  examples: ['curl -H "Authorization: Bearer $(sume auth token)" https://api.sume.com/v1/me'],
  run: async (_parsed, ctx) => {
    const { session } = ctx.settings;
    if (!session) {
      if (ctx.settings.apiKey) {
        throw new CliError("This computer uses an API key, not a Sume sign-in, so there is no access token.", {
          exitCode: ExitCode.Auth,
          code: "no_sign_in",
          hint: "Send the key itself (SUME_API_KEY), or sign in with `sume login`.",
        });
      }
      throw loginRequired("Not signed in.");
    }
    const credential = new SessionCredential({ session, configPath: ctx.settings.configPath, fetch: ctx.fetch });
    const value = await credential.token(ctx.signal);
    if (ctx.json) ctx.ui.json({ access_token: value, expires_at: credential.session.expires_at });
    else ctx.ui.out(value);
    return ExitCode.Ok;
  },
};

const workspacesList: CommandSpec = {
  name: "list",
  aliases: ["ls"],
  summary: "List the workspaces you can work in",
  run: async (_parsed, ctx) => {
    const { ui } = ctx;
    ctx.client().requireKey();
    ui.spin("Reading workspaces");
    const list = await ctx.client().listWorkspaces(ctx.signal);
    ui.stopSpinner();
    if (ctx.json) {
      ui.json(list);
      return ExitCode.Ok;
    }
    ui.table(
      ["", "WORKSPACE", "KIND", "ID"],
      list.data.map((w) => [w.is_selected ? "*" : "", w.name, w.kind, w.id]),
    );
    if (!list.switchable) {
      ui.info(ui.c.dim("\nAn API key works in its own workspace only. To switch, sign in with: sume login"));
    }
    return ExitCode.Ok;
  },
};

export function pickWorkspace(list: WorkspaceList, input: string): Workspace {
  const wanted = input.trim();
  const byId = list.data.find((w) => w.id === wanted);
  if (byId) return byId;
  const byName = list.data.filter((w) => w.name.toLowerCase() === wanted.toLowerCase());
  if (byName.length === 1) return byName[0] as Workspace;
  if (byName.length > 1) {
    throw new UsageError(
      `${byName.length} workspaces are named "${wanted}": ${byName.map((w) => w.id).join(", ")}.`,
      "Pick one by its id.",
    );
  }
  throw new CliError(`No workspace "${wanted}" among yours.`, {
    exitCode: ExitCode.Rejected,
    code: "workspace_not_found",
    hint: `Yours: ${list.data.map((w) => `${w.name} (${w.id})`).join(", ")}. See them with: sume workspaces list`,
  });
}

const workspacesSelect: CommandSpec = {
  name: "select",
  aliases: ["switch"],
  summary: "Switch the workspace a Sume sign-in works in",
  description:
    "From the next command on, runs bill the chosen workspace, and jobs and uploads are read from it. The choice " +
    "stays with the sign-in. Give the workspace's id or its exact name. An API key cannot switch.",
  args: [{ name: "workspace", required: true, description: "The workspace's id, or its exact name" }],
  examples: ["sume workspaces select <WORKSPACE>", "sume workspaces select Personal"],
  run: async (parsed, ctx) => {
    const { ui } = ctx;
    ctx.client().requireKey();
    const list = await ctx.client().listWorkspaces(ctx.signal);
    const current = selectedWorkspace(list);
    const asked = (parsed.args[0] as string).trim();
    if (
      !list.switchable &&
      !(current && (current.id === asked || current.name.toLowerCase() === asked.toLowerCase()))
    ) {
      throw new CliError("An API key works in its own workspace only, so it cannot switch.", {
        exitCode: ExitCode.Rejected,
        code: "workspace_fixed",
        hint: "Sign in with Sume to switch workspaces: sume login. Or use a key made in that workspace.",
      });
    }
    const target = pickWorkspace(list, asked);
    if (current?.id === target.id) {
      if (ctx.json) ui.json({ workspace: target, previous_workspace_id: target.id, outcome: "unchanged" });
      else ui.success(`Already working in ${workspaceLabel(target)}.`);
      return ExitCode.Ok;
    }
    try {
      const done = await ctx.client().selectWorkspace(target.id, ctx.signal);
      if (ctx.json) ui.json({ ...done, outcome: "selected" });
      else ui.success(`Working in ${workspaceLabel(done.workspace)}. Runs bill it from now on.`);
      return ExitCode.Ok;
    } catch (error) {
      if (error instanceof ApiError && error.apiCode === "workspace_fixed") {
        throw error.rephrased(
          "An API key works in its own workspace only, so it cannot switch.",
          "Sign in with Sume to switch workspaces: sume login. Or use a key made in that workspace.",
        );
      }
      throw error;
    }
  },
};

export const workspaces: CommandSpec = {
  name: "workspaces",
  aliases: ["workspace"],
  group: "Account",
  summary: "List or switch workspaces",
  commands: [workspacesList, workspacesSelect],
};

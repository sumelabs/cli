import type { Balance, UsageRow, Workspace, WorkspaceList } from "../api/types.ts";
import type { Context } from "../context.ts";
import type { CommandSpec } from "../lib/args.ts";
import { BILLING_URL, maskKey } from "../lib/config.ts";
import { ExitCode } from "../lib/errors.ts";
import { formatAge, formatUsd } from "../lib/ui.ts";

export function selectedWorkspace(list: WorkspaceList | undefined): Workspace | undefined {
  if (!list) return undefined;
  return list.data.find((w) => w.is_selected) ?? list.data.find((w) => w.id === list.selected_workspace_id);
}

export async function currentWorkspace(ctx: Context): Promise<Workspace | undefined> {
  return selectedWorkspace(
    await ctx
      .client()
      .listWorkspaces(ctx.signal)
      .catch(() => undefined),
  );
}

export function workspaceLabel(workspace: Pick<Workspace, "name" | "kind"> | undefined): string {
  if (!workspace) return "unknown workspace";
  return workspace.kind === "personal" ? `${workspace.name} (personal)` : `${workspace.name} (team)`;
}

export async function noteDotenvKey(ctx: Context): Promise<void> {
  const { apiKey, apiKeySource } = ctx.settings;
  if (apiKeySource !== "dotenv" || !apiKey || ctx.json) return;
  const workspace = await currentWorkspace(ctx);
  ctx.ui.info(
    ctx.ui.c.dim(
      `Using SUME_API_KEY from ./.env (${maskKey(apiKey)}): it bills ${workspace ? workspaceLabel(workspace) : "that key's workspace"}.`,
    ),
  );
}

export function credits(count: number): string {
  return `${count.toLocaleString("en-US")} credit${count === 1 ? "" : "s"}`;
}

export function balanceLine(balance: Balance): string {
  const usd = balance.available_usd ? formatUsd(balance.available_usd) : undefined;
  return usd ? `${usd} (${credits(balance.available_credits)})` : credits(balance.available_credits);
}

export function balanceSummary(balance: Balance) {
  return {
    available_usd: balance.available_usd ?? null,
    available_credits: balance.available_credits,
    state: balance.state,
  };
}

const get: CommandSpec = {
  name: "get",
  aliases: ["show"],
  summary: "Show the workspace and the key or sign-in this computer uses",
  description:
    "Reads GET /v1/me and the workspace it bills: the workspace's name and id, and the key's name, prefix and " +
    "scopes. Spends nothing. A key belongs to one workspace; a Sume sign-in can switch with `sume workspaces select`.",
  examples: ["sume account get", "sume account get --json | jq -r .workspace.name"],
  run: async (_parsed, ctx) => accountGet(ctx),
};

async function accountGet(ctx: Context): Promise<number> {
  const { ui } = ctx;
  const client = ctx.client();
  client.requireKey();
  ui.spin("Reading the account");
  const [account, workspaces] = await Promise.all([
    client.getAccount(ctx.signal),
    client.listWorkspaces(ctx.signal).catch(() => undefined),
  ]);
  ui.stopSpinner();
  const workspace = selectedWorkspace(workspaces);
  if (ctx.json) {
    ui.json({ account, workspace: workspace ?? null });
    return ExitCode.Ok;
  }
  const { c } = ui;
  const row = (label: string, value: string) => ui.out(`${c.dim(label.padEnd(11))}${value}`);
  row("Workspace", `${workspace ? workspaceLabel(workspace) : "—"} ${c.dim(account.workspace_id)}`);
  const signIn =
    Boolean(ctx.settings.session) ||
    account.auth_source === "mcp_oauth" ||
    Boolean(account.api_key?.id?.startsWith("mcp_oauth_token_"));
  if (account.api_key) {
    if (signIn) row("Key", "Sume sign-in");
    else {
      const name = account.api_key.name ? `${account.api_key.name} ` : "";
      row("Key", `${name}${c.dim(`${account.api_key.prefix}…`)}`);
    }
    row("Scopes", account.api_key.scopes.join(", ") || "—");
  }
  row("Signed in", signIn ? "with Sume (sume login)" : "with an API key");
  return ExitCode.Ok;
}

export const account: CommandSpec = {
  name: "account",
  group: "Account",
  summary: "Show the workspace and key this computer uses",
  commands: [get],
};

export const me: CommandSpec = {
  name: "me",
  group: "Account",
  hidden: true,
  summary: "Show the workspace and key this computer uses (sume account get)",
  run: async (_parsed, ctx) => accountGet(ctx),
};

export const balance: CommandSpec = {
  name: "balance",
  group: "Account",
  summary: "Show what the workspace can spend, in dollars and credits",
  description:
    "Reads GET /v1/balance for the workspace the key or sign-in bills. Spends nothing. A run checks the balance " +
    "again when it is submitted; `--max-usd` caps what one run may cost.",
  examples: ["sume balance", "sume balance --json | jq -r .balance.available_usd"],
  run: async (_parsed, ctx) => {
    const { ui } = ctx;
    const client = ctx.client();
    client.requireKey();
    ui.spin("Reading the balance");
    const [found, workspaces] = await Promise.all([
      client.getBalance(ctx.signal),
      client.listWorkspaces(ctx.signal).catch(() => undefined),
    ]);
    ui.stopSpinner();
    const workspace = selectedWorkspace(workspaces);
    if (ctx.json) {
      ui.json({ balance: found, workspace: workspace ?? null });
      return ExitCode.Ok;
    }
    const { c } = ui;
    ui.out(`${c.bold(balanceLine(found))}  ${c.dim(workspaceLabel(workspace))}`);
    const soon = found.expiration?.expiring_soon_credits ?? 0;
    if (soon > 0) {
      ui.warn(`${credits(soon)} expire within ${found.expiration?.expiring_soon_days ?? 30} days.`);
    }
    if (found.invoice) ui.info(c.dim("Invoiced: runs are held to this billing period's invoice limit."));
    if (found.state === "empty") ui.warn(`Nothing to spend. Top up at ${BILLING_URL}`);
    return ExitCode.Ok;
  },
};

const usageList: CommandSpec = {
  name: "list",
  aliases: ["ls", "get"],
  summary: "List what recent jobs cost, newest first",
  description:
    "Reads GET /v1/usage: one row per charge, with its job, status (reserved, captured or refunded) and credits.",
  flags: [
    {
      name: "limit",
      short: "l",
      type: "number",
      min: 1,
      max: 100,
      integer: true,
      placeholder: "<n>",
      description: "How many rows, 1–100 (default 20)",
    },
    { name: "job", type: "string", placeholder: "<job>", description: "Only this job's rows" },
  ],
  examples: ["sume usage list", "sume usage list --limit 5 --json | jq '.usage[] | {job_id, credits}'"],
  run: async (parsed, ctx) => {
    const { ui } = ctx;
    const client = ctx.client();
    client.requireKey();
    const limit = (parsed.flags.limit as number | undefined) ?? 20;
    ui.spin("Reading usage");
    const job = parsed.flags.job as string | undefined;
    const page = await client.listUsage(limit, ctx.signal, job ? { job_id: job } : {});
    ui.stopSpinner();
    if (ctx.json) {
      ui.json(page);
      return ExitCode.Ok;
    }
    if (page.usage.length === 0) {
      ui.info("No usage yet.");
      return ExitCode.Ok;
    }
    ui.table(
      ["WHEN", "JOB", "OPERATION", "STATUS", "CREDITS", "USD"],
      page.usage.map((row: UsageRow) => [
        formatAge(row.created_at),
        row.job_id ?? "—",
        row.operation_type,
        row.status,
        String(row.credits),
        row.usd ? formatUsd(row.usd) : "—",
      ]),
    );
    return ExitCode.Ok;
  },
};

export const usage: CommandSpec = {
  name: "usage",
  group: "Account",
  summary: "List what recent jobs cost",
  commands: [usageList],
};

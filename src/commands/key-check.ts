import { SumeClient } from "../api/client.ts";
import { ApiError } from "../api/errors.ts";
import type { Context } from "../context.ts";
import { KEYS_URL, otherHostHint } from "../lib/config.ts";
import { CliError, ExitCode } from "../lib/errors.ts";

export async function checkKey(ctx: Context, key: string): Promise<{ ok: true } | { ok: false; error: CliError }> {
  const client = new SumeClient({
    baseUrl: ctx.settings.baseUrl,
    apiKey: key,
    userAgent: ctx.userAgent,
    maxRetries: 1,
  });
  try {
    await client.listJobs({ limit: 1 }, ctx.signal);
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      return {
        ok: false,
        error: new CliError(
          error.apiCode === "unauthorized" ? "The API does not accept this key (wrong or revoked)." : error.message,
          {
            exitCode: ExitCode.Auth,
            code: error.apiCode,
            hint:
              error.apiCode === "unauthorized"
                ? `${otherHostHint(client.baseUrl)} Or create a new key at ${KEYS_URL}.`
                : error.hint,
          },
        ),
      };
    }
    if (error instanceof CliError) return { ok: false, error };
    throw error;
  }
}

export async function checkSession(ctx: Context): Promise<{ ok: true } | { ok: false; error: CliError }> {
  try {
    await ctx.client().listJobs({ limit: 1 }, ctx.signal);
    return { ok: true };
  } catch (error) {
    if (error instanceof CliError) return { ok: false, error };
    throw error;
  }
}

import { readFile } from "node:fs/promises";
import path from "node:path";

const WINDOWS_USER_AGENT = /powershell|pwsh|windows/i;

export type InstallerPlatform = "sh" | "ps1";
type ScriptLoader = (platform: InstallerPlatform) => Promise<string | null>;

export function detectInstallerPlatform(
  userAgent: string | null,
): InstallerPlatform {
  return WINDOWS_USER_AGENT.test(userAgent ?? "") ? "ps1" : "sh";
}

function scriptFileName(platform: InstallerPlatform) {
  return platform === "ps1" ? "install.ps1" : "install.sh";
}

export async function readLocalInstallScript(
  platform: InstallerPlatform,
): Promise<string | null> {
  const file = scriptFileName(platform);
  const roots = [
    process.env.SUME_CLI_INSTALLER_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ].filter((value): value is string => Boolean(value));

  for (const root of roots) {
    try {
      return await readFile(path.join(root, file), "utf8");
    } catch {
      // Try the next candidate root before failing closed.
    }
  }

  return null;
}

export async function serveInstallScript(
  platform: InstallerPlatform,
  {
    scriptLoader = readLocalInstallScript,
  }: {
    scriptLoader?: ScriptLoader;
  } = {},
): Promise<Response> {
  const localScript = await scriptLoader(platform);
  if (localScript !== null) {
    return new Response(localScript, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  return new Response("install script unavailable\n", {
    status: 502,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

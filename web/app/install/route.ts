import type { NextRequest } from "next/server";
import { detectInstallerPlatform, serveInstallScript } from "../../lib/install";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const platform = detectInstallerPlatform(request.headers.get("user-agent"));
  return serveInstallScript(platform);
}

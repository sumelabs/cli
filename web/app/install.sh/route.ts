import { serveInstallScript } from "../../lib/install";

export const dynamic = "force-dynamic";

export async function GET() {
  return serveInstallScript("sh");
}

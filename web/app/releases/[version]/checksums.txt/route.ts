import { findReleaseAsset, loadReleaseManifest } from "../../../../lib/releases";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ version: string }> },
) {
  try {
    const { version } = await context.params;
    const manifest = await loadReleaseManifest(version);
    const asset = findReleaseAsset(manifest, "checksums.txt");
    if (!asset) throw new Error("missing checksums");
    return Response.redirect(asset.url, 302);
  } catch {
    return new Response("checksums unavailable\n", {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}

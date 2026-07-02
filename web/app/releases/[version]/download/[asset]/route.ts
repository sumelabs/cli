import { findReleaseAsset, loadReleaseManifest } from "../../../../../lib/releases";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ version: string; asset: string }> },
) {
  try {
    const { version, asset: assetName } = await context.params;
    const manifest = await loadReleaseManifest(version);
    const asset = findReleaseAsset(manifest, assetName);
    if (!asset) throw new Error("missing asset");
    return Response.redirect(asset.url, 302);
  } catch {
    return new Response("release asset unavailable\n", {
      status: 404,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }
}

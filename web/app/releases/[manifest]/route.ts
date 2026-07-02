import {
  loadReleaseManifest,
  releaseManifestCacheControl,
} from "../../../lib/releases";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ manifest: string }> },
) {
  try {
    const { manifest: requested } = await context.params;
    const release = await loadReleaseManifest(requested);
    return Response.json(release, {
      headers: {
        "cache-control": releaseManifestCacheControl(requested),
      },
    });
  } catch {
    return Response.json(
      { error: "release manifest unavailable" },
      {
        status: 404,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}

type ReleaseAsset = {
  name: string;
  platform: string;
  url: string;
  sha256: string;
  size: number;
};

type ReleaseManifest = {
  object: "sume_cli_release";
  version: string;
  tag: string;
  checksums: ReleaseAsset;
  assets: Record<string, ReleaseAsset>;
};

const GITHUB_RELEASE_BASE = "https://github.com/sumelabs/cli/releases";

export async function loadReleaseManifest(
  requested: string,
  {
    fetcher = fetch,
  }: {
    fetcher?: typeof fetch;
  } = {},
): Promise<ReleaseManifest> {
  const response = await fetcher(releaseManifestUrl(requested), {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Unable to fetch release manifest: HTTP ${response.status}`);
  }
  return assertReleaseManifest(await response.json());
}

export function releaseManifestCacheControl(requested: string) {
  return normalizeRequestedVersion(requested) === "latest"
    ? "no-store"
    : "public, max-age=300";
}

export function findReleaseAsset(manifest: ReleaseManifest, assetName: string) {
  if (assetName === "checksums.txt") return manifest.checksums;
  return manifest.assets[assetName] ?? null;
}

function releaseManifestUrl(requested: string) {
  const normalized = normalizeRequestedVersion(requested);
  if (normalized === "latest") {
    return `${GITHUB_RELEASE_BASE}/latest/download/manifest.json`;
  }
  return `${GITHUB_RELEASE_BASE}/download/v${normalized}/manifest.json`;
}

function normalizeRequestedVersion(requested: string) {
  const withoutJson = requested.trim().replace(/\.json$/u, "");
  if (withoutJson === "latest") return "latest";
  return withoutJson.replace(/^v/u, "");
}

function assertReleaseManifest(value: unknown): ReleaseManifest {
  if (!isRecord(value) || value.object !== "sume_cli_release") {
    throw new Error("Release manifest is invalid.");
  }
  if (
    !isNonEmptyString(value.version) ||
    !isNonEmptyString(value.tag) ||
    !isReleaseAsset(value.checksums) ||
    !isRecord(value.assets)
  ) {
    throw new Error("Release manifest is incomplete.");
  }
  const assets: Record<string, ReleaseAsset> = {};
  for (const [name, asset] of Object.entries(value.assets)) {
    if (!isReleaseAsset(asset)) {
      throw new Error(`Release manifest asset is invalid: ${name}`);
    }
    assets[name] = asset;
  }
  return {
    object: "sume_cli_release",
    version: value.version,
    tag: value.tag,
    checksums: value.checksums,
    assets,
  };
}

function isReleaseAsset(value: unknown): value is ReleaseAsset {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.platform) &&
    isNonEmptyString(value.url) &&
    value.url.startsWith("https://") &&
    /^[a-f0-9]{64}$/u.test(String(value.sha256)) &&
    typeof value.size === "number" &&
    Number.isFinite(value.size) &&
    value.size > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

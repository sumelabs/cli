#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OWNER = "sumelabs";
const REPO = "cli";
const assets = [
  { name: "sume-darwin-arm64", platform: "darwin-arm64" },
  { name: "sume-darwin-x64", platform: "darwin-x64" },
  { name: "sume-linux-arm64", platform: "linux-arm64" },
  { name: "sume-linux-x64", platform: "linux-x64" },
  { name: "sume-windows-x64.exe", platform: "windows-x64" },
];

const args = parseArgs(process.argv.slice(2));
const version = required(args.version, "--version");
const tag = args.tag ?? `v${version}`;
const releaseDir = args["release-dir"] ?? "release";

const checksumPath = join(releaseDir, "checksums.txt");
const checksums = readChecksums(checksumPath);
const manifestAssets = {};

for (const asset of assets) {
  const file = join(releaseDir, asset.name);
  manifestAssets[asset.name] = {
    name: asset.name,
    platform: asset.platform,
    url: releaseAssetUrl(tag, asset.name),
    sha256: checksums.get(asset.name) ?? fileSha256(file),
    size: statSync(file).size,
  };
}

const manifest = {
  object: "sume_cli_release",
  version,
  tag,
  created_at: new Date().toISOString(),
  checksums: {
    name: "checksums.txt",
    platform: "checksums",
    url: releaseAssetUrl(tag, "checksums.txt"),
    sha256: fileSha256(checksumPath),
    size: statSync(checksumPath).size,
  },
  assets: manifestAssets,
};

writeFileSync(
  join(releaseDir, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(
  JSON.stringify(
    {
      object: "sume_cli_github_release_manifest",
      version,
      tag,
      asset_count: assets.length,
    },
    null,
    2,
  ),
);

function releaseAssetUrl(tag, name) {
  return `https://github.com/${OWNER}/${REPO}/releases/download/${tag}/${name}`;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key?.startsWith("--")) continue;
    parsed[key.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readChecksums(file) {
  const checksums = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const [checksum, name] = line.trim().split(/\s+/u);
    if (checksum && name) checksums.set(name, checksum);
  }
  return checksums;
}

function fileSha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

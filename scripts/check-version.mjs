import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const source = fs.readFileSync("src/lib/version.ts", "utf8");
const sourceMatch = source.match(/export const VERSION = "([^"]+)";/u);
const expectedVersion = normalizeVersion(
  process.env.SUME_RELEASE_VERSION ?? process.argv[2] ?? "",
);

if (!sourceMatch) {
  fail('Could not find `export const VERSION = "..."` in src/lib/version.ts.');
}

const packageVersion = packageJson.version;
const sourceVersion = sourceMatch[1];

if (!isSemver(packageVersion)) {
  fail(`package.json version is not semver: ${packageVersion}`);
}

if (packageVersion !== sourceVersion) {
  fail(
    `Version mismatch: package.json has ${packageVersion}, src/lib/version.ts has ${sourceVersion}.`,
  );
}

if (expectedVersion && packageVersion !== expectedVersion) {
  fail(
    `Release version mismatch: expected ${expectedVersion}, package/source has ${packageVersion}.`,
  );
}

console.log(`Version check passed: ${packageVersion}`);

function normalizeVersion(version) {
  return version.trim().replace(/^v/u, "");
}

function isSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "..");

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/install": ["./install.sh", "./install.ps1"],
    "/install.sh": ["./install.sh"],
    "/install.ps1": ["./install.ps1"],
  },
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;

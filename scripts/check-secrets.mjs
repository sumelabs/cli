import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([
  ".git",
  "coverage",
  "dist",
  "node_modules",
  ".next",
]);
const ignoredFiles = new Set(["pnpm-lock.yaml", "bun.lock", "check-secrets.mjs"]);

const patterns = [
  { name: "private key", regex: /BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY/u },
  { name: "GitHub token", regex: /gh[pousr]_[A-Za-z0-9_]{20,}/u },
  { name: "OpenAI-style key", regex: /sk-[A-Za-z0-9_-]{24,}/u },
  { name: "Sume live key", regex: /sume_live_[A-Za-z0-9_-]{16,}/u },
  { name: "signed URL query", regex: /X-Amz-Signature=|Signature=/u },
];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    if (
      !entry.isFile() ||
      ignoredFiles.has(entry.name) ||
      entry.name.endsWith(".bun-build")
    ) {
      return [];
    }
    return [fullPath];
  });
}

const findings = [];
for (const file of walk(root)) {
  const relative = path.relative(root, file);
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    if (pattern.regex.test(content)) {
      findings.push(`${relative}: ${pattern.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("No obvious secrets found.");

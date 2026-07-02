import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundledSkillFiles } from "./bundled-skills-data.js";
import { CliError } from "./errors.js";

const AGENT_ROOTS = [".agents", ".claude"] as const;
const SKILLS_SUBDIR = "skills";
const INSTALLED_MANIFEST = ".installed.json";
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

export type SkillFile = {
  bytes: number;
  path: string;
  sha256: string;
};

export type SkillEntry = {
  description: string;
  files: SkillFile[];
  name: string;
};

export type InstalledSkill = SkillEntry & {
  installed_at: string;
  source: "bundled";
};

type InstalledManifest = {
  skills: InstalledSkill[];
  version: 1;
};

export function listBundledSkills(query = "") {
  const skills = bundledSkillEntries();
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? skills.filter((skill) =>
        `${skill.name} ${skill.description}`.toLowerCase().includes(normalized),
      )
    : skills;
  return {
    object: "skill_list",
    source: "bundled",
    count: filtered.length,
    skills: filtered,
  };
}

export function installBundledSkill(
  cwd: string,
  name: string,
  options: { force?: boolean } = {},
) {
  name = validateSkillName(name);
  const skill = findBundledSkill(name);
  const base = requireSkillsBase(cwd);
  const manifest = readInstalledManifest(cwd, base);
  const already = manifest.skills.some((entry) => entry.name === name);
  if (already && !options.force) {
    return {
      object: "skill_install",
      name,
      status: "skipped",
      installed_dir: join(base, name),
      files: skill.files.map((file) => file.path),
    };
  }

  const root = resolveInside(join(cwd, base), name);
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });

  for (const file of skill.files) {
    const content = readBundledSkillFile(name, file.path);
    const actual = sha256(content);
    if (actual !== file.sha256) {
      throw new CliError(`Bundled skill checksum mismatch: ${name}/${file.path}`, {
        code: "checksum_mismatch",
      });
    }
    const target = resolveInside(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }

  const installed: InstalledSkill = {
    ...skill,
    installed_at: new Date().toISOString(),
    source: "bundled",
  };
  writeInstalledManifest(cwd, base, {
    version: 1,
    skills: [...manifest.skills.filter((entry) => entry.name !== name), installed]
      .sort((a, b) => a.name.localeCompare(b.name)),
  });

  return {
    object: "skill_install",
    name,
    status: already ? "updated" : "installed",
    installed_dir: join(base, name),
    files: skill.files.map((file) => file.path),
  };
}

export function updateBundledSkills(cwd: string, name?: string) {
  const base = requireSkillsBase(cwd);
  const manifest = readInstalledManifest(cwd, base);
  const targets = name
    ? [validateSkillName(name)]
    : manifest.skills.map((skill) => skill.name);
  return {
    object: "skill_update",
    count: targets.length,
    skills: targets.map((target) =>
      installBundledSkill(cwd, target, { force: true }),
    ),
  };
}

export function removeInstalledSkill(cwd: string, name: string) {
  name = validateSkillName(name);
  const base = resolveSkillsBase(cwd);
  if (!base) {
    return { object: "skill_remove", name, removed: false, installed_dir: null };
  }
  const manifest = readInstalledManifest(cwd, base);
  const root = resolveInside(join(cwd, base), name);
  const existed = existsSync(root);
  if (existed) rmSync(root, { recursive: true, force: true });
  writeInstalledManifest(cwd, base, {
    version: 1,
    skills: manifest.skills.filter((skill) => skill.name !== name),
  });
  return {
    object: "skill_remove",
    name,
    removed: existed || manifest.skills.some((skill) => skill.name === name),
    installed_dir: join(base, name),
  };
}

export function exportBundledSkill(name: string) {
  name = validateSkillName(name);
  const skill = findBundledSkill(name);
  return {
    object: "skill_export",
    skill,
    files: Object.fromEntries(
      skill.files.map((file) => [
        file.path,
        readBundledSkillFile(name, file.path),
      ]),
    ),
  };
}

function bundledSkillEntries(): SkillEntry[] {
  return bundledSkillNames()
    .map((entry) => readSkillEntry(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readSkillEntry(name: string): SkillEntry {
  const files = bundledSkillPaths(name).map((path) => {
    const content = readBundledSkillFile(name, path);
    return { path, bytes: Buffer.byteLength(content, "utf8"), sha256: sha256(content) };
  });
  const skillFile = readBundledSkillFile(name, "SKILL.md");
  const description =
    /^description:\s*(.+)$/mu.exec(skillFile)?.[1]?.trim() ??
    `Sume skill ${name}.`;
  return { name, description, files };
}

function findBundledSkill(name: string) {
  const skill = bundledSkillEntries().find((entry) => entry.name === name);
  if (!skill) {
    throw new CliError(`Unknown bundled skill: ${name}`, {
      code: "skill_not_found",
      hint: "Run sume skills list --json to see bundled skills.",
    });
  }
  return skill;
}

function listFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listFiles(root, path);
    if (entry.isFile()) return [path];
    return [];
  });
}

function bundledSkillNames() {
  const root = agentRoot();
  if (root) {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SKILL_NAME_PATTERN.test(entry.name))
      .map((entry) => ({ name: entry.name }));
  }
  return Object.keys(bundledSkillFiles)
    .filter((name) => SKILL_NAME_PATTERN.test(name))
    .map((name) => ({ name }));
}

function bundledSkillPaths(name: string) {
  const root = agentRoot();
  if (root) return listFiles(join(root, name));
  const files = embeddedSkill(name);
  return Object.keys(files).sort();
}

function readBundledSkillFile(name: string, path: string) {
  const root = agentRoot();
  if (root) return readFileSync(join(root, name, path), "utf8");
  const content = embeddedSkill(name)[path];
  if (content !== undefined) return content;
  throw new CliError(`Bundled skill file not found: ${name}/${path}`, {
    code: "skill_not_found",
  });
}

function embeddedSkill(name: string): Record<string, string> {
  const files = (bundledSkillFiles as Record<string, Record<string, string>>)[name];
  if (files) return files;
  throw new CliError(`Unknown bundled skill: ${name}`, {
    code: "skill_not_found",
    hint: "Run sume skills list --json to see bundled skills.",
  });
}

function agentRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../agent"),
    resolve(here, "../agent"),
    resolve(process.cwd(), "agent"),
  ];
  const root = candidates.find(
    (candidate) => existsSync(join(candidate, "sume", "SKILL.md")),
  );
  return root;
}

function resolveSkillsBase(cwd: string) {
  for (const root of AGENT_ROOTS) {
    if (existsSync(join(cwd, root))) return join(root, SKILLS_SUBDIR);
  }
  return null;
}

function requireSkillsBase(cwd: string) {
  const base = resolveSkillsBase(cwd);
  if (base) return base;
  throw new CliError("No agent directory found for skill installation.", {
    code: "missing_agent_directory",
    hint: "Create .agents/ or .claude/ in this project, then rerun sume skills install.",
  });
}

function readInstalledManifest(cwd: string, base: string): InstalledManifest {
  const path = join(cwd, base, INSTALLED_MANIFEST);
  if (!existsSync(path)) return { version: 1, skills: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as InstalledManifest;
    if (parsed.version === 1 && Array.isArray(parsed.skills)) return parsed;
  } catch {
    // Treat corrupt local install manifests as empty; installs rewrite them.
  }
  return { version: 1, skills: [] };
}

function writeInstalledManifest(cwd: string, base: string, manifest: InstalledManifest) {
  const path = join(cwd, base, INSTALLED_MANIFEST);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function resolveInside(root: string, relPath: string) {
  const target = resolve(root, relPath);
  const rel = relative(resolve(root), target);
  if (rel === "" || rel.startsWith("..") || rel === "..") {
    throw new CliError(`Refusing to write outside skill directory: ${relPath}`, {
      code: "invalid_argument",
    });
  }
  return target;
}

function validateSkillName(name: string) {
  if (SKILL_NAME_PATTERN.test(name)) return name;
  throw new CliError(`Invalid skill name: ${name}`, { code: "invalid_argument" });
}

function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function assertBundledSkillsAvailable() {
  return Boolean(agentRoot()) || Object.keys(bundledSkillFiles).length > 0;
}

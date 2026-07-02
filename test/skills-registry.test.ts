import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  exportBundledSkill,
  installBundledSkill,
  listBundledSkills,
  removeInstalledSkill,
  updateBundledSkills,
} from "../src/lib/skills-registry.js";
import { bundledSkillFiles } from "../src/lib/bundled-skills-data.js";

describe("skills registry", () => {
  it("lists bundled sume.com skills and excludes old sume.so surfaces", () => {
    const result = listBundledSkills();
    expect(result.skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining([
        "sume",
        "sume-assets",
        "sume-avatar",
        "sume-avatar-video",
        "sume-tools",
      ]),
    );
    const exported = exportBundledSkill("sume");
    const body = JSON.stringify(exported);
    expect(body).toContain("api.sume.com");
    expect(body).toContain("Not For");
    expect(body).toContain("Face Swap");
    expect(body).toContain("Do not use old");
    expect(body).toContain("current public `api.sume.com` catalog");
  });

  it("installs, updates, and removes bundled skills in a temp project", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-skills-"));
    try {
      fs.mkdirSync(path.join(tempDir, ".agents"));
      const installed = installBundledSkill(tempDir, "sume-avatar");
      expect(installed).toMatchObject({
        name: "sume-avatar",
        status: "installed",
        installed_dir: path.join(".agents", "skills", "sume-avatar"),
      });
      expect(
        fs.existsSync(path.join(tempDir, ".agents", "skills", "sume-avatar", "SKILL.md")),
      ).toBe(true);

      const updated = updateBundledSkills(tempDir, "sume-avatar");
      expect(updated.skills).toEqual([
        expect.objectContaining({ name: "sume-avatar", status: "updated" }),
      ]);

      const removed = removeInstalledSkill(tempDir, "sume-avatar");
      expect(removed).toMatchObject({
        name: "sume-avatar",
        removed: true,
        installed_dir: path.join(".agents", "skills", "sume-avatar"),
      });
      expect(
        fs.existsSync(path.join(tempDir, ".agents", "skills", "sume-avatar")),
      ).toBe(false);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps embedded binary fallback skills in sync with agent files", () => {
    for (const [skill, files] of Object.entries(bundledSkillFiles)) {
      for (const [file, content] of Object.entries(files)) {
        expect(fs.readFileSync(path.join("agent", skill, file), "utf8")).toBe(
          content,
        );
      }
    }
  });
});

import { Command } from "commander";
import { getMode, showSubcommandHelp } from "../lib/command.js";
import { renderResult } from "../lib/render.js";
import {
  exportBundledSkill,
  installBundledSkill,
  listBundledSkills,
  removeInstalledSkill,
  updateBundledSkills,
} from "../lib/skills-registry.js";

export function registerSkillsCommand(program: Command) {
  const skills = program
    .command("skills")
    .description("List, install, export, update, and remove bundled Sume skills.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  skills
    .command("list")
    .description("List bundled Sume agent skills.")
    .argument("[query]", "Optional skill search query.")
    .action((query: string | undefined, _options, command: Command) => {
      const result = listBundledSkills(query);
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Source", result.source],
          ["Skills", result.count],
          ...result.skills.map((skill) => [skill.name, skill.description] as [string, string]),
        ],
      });
    });

  skills
    .command("install")
    .description("Install a bundled Sume skill into .agents/skills or .claude/skills.")
    .argument("[name]", "Skill name.", "sume")
    .option("--force", "Reinstall even if already installed.")
    .action((name: string, options: { force?: boolean }, command: Command) => {
      const result = installBundledSkill(process.cwd(), name, {
        force: Boolean(options.force),
      });
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Skill", result.name],
          ["Status", result.status],
          ["Installed dir", result.installed_dir],
        ],
      });
    });

  skills
    .command("update")
    .description("Refresh installed bundled Sume skills.")
    .argument("[name]", "Optional installed skill name.")
    .action((name: string | undefined, _options, command: Command) => {
      const result = updateBundledSkills(process.cwd(), name);
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Updated", result.count],
          ...result.skills.map((skill) => [skill.name, skill.status] as [string, string]),
        ],
      });
    });

  skills
    .command("remove")
    .description("Remove an installed bundled Sume skill.")
    .argument("[name]", "Skill name.", "sume")
    .action((name: string, _options, command: Command) => {
      const result = removeInstalledSkill(process.cwd(), name);
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Skill", result.name],
          ["Removed", result.removed],
          ["Installed dir", result.installed_dir ?? "n/a"],
        ],
      });
    });

  skills
    .command("export")
    .description("Print bundled skill source files as JSON for review or custom install.")
    .argument("[name]", "Skill name.", "sume")
    .action((name: string, _options, command: Command) => {
      const result = exportBundledSkill(name);
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Skill", result.skill.name],
          ["Files", result.skill.files.length],
        ],
      });
    });
}

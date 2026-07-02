#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import "dotenv/config";
import { registerAccountCommand } from "./commands/account.js";
import { registerAssetsCommand } from "./commands/assets.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerAvatarVideosCommand } from "./commands/avatar-videos.js";
import { registerAvatarsCommand } from "./commands/avatars.js";
import { registerCatalogCommand } from "./commands/catalog.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerFilesCommand } from "./commands/files.js";
import { registerHealthCommand } from "./commands/health.js";
import { registerJobsCommand } from "./commands/jobs.js";
import { registerMcpCommand } from "./commands/mcp.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { registerToolsCommand } from "./commands/tools.js";
import { registerUsageCommand } from "./commands/usage.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version.js";
import { CliError } from "./lib/errors.js";
import { mcpComingSoonStatus } from "./lib/mcp-launch-status.js";
import { emitError, outputJson } from "./lib/output.js";
import {
  colors,
  command as formatCommand,
  flag,
  helpBanner,
} from "./lib/ui.js";
import { VERSION } from "./lib/version.js";

const program = new Command();
const jsonRequested = process.argv.includes("--json");

program
  .name("sume")
  .description("Agent-first CLI for sume.com")
  .version(VERSION)
  .option("--json", "Print stable JSON output.")
  .showHelpAfterError();

program.exitOverride();
if (jsonRequested) {
  program.configureOutput({
    writeErr: () => {
      // Keep JSON-mode stderr machine-readable. Commander validation errors are
      // converted to structured JSON in the catch block below.
    },
  });
}

program.configureHelp({
  styleTitle: (title) =>
    colors.bold(colors.whiteBright(title.replace(/:$/u, ""))),
  styleUsage: (usage) => formatCommand(usage),
  styleCommandText: (text) => formatCommand(text),
  styleSubcommandText: (text) => formatCommand(text),
  styleSubcommandTerm: (term) => formatCommand(term),
  styleOptionText: (text) => flag(text),
  styleOptionTerm: (term) => flag(term),
  styleArgumentText: (text) => colors.whiteBright(text),
  styleArgumentTerm: (term) => colors.whiteBright(term),
  styleDescriptionText: (text) => colors.dim(text),
});

if (
  process.argv.includes("--json") &&
  !process.argv.slice(2).some((arg) => !arg.startsWith("-"))
) {
  outputJson({
    name: "sume",
    version: VERSION,
    description: "Agent-first CLI for sume.com",
    api_base_url: "https://api.sume.com/v1",
    install: {
      hosted_installer: "curl https://cli.sume.com/install -fsS | bash",
      powershell_installer: "irm https://cli.sume.com/install.ps1 | iex",
      release_artifacts: "GitHub Releases",
      verifies_release_checksums: true,
    },
    update: {
      check_command: "sume update --check",
      mutates_local_files: false,
      install_command_source: "hosted installer",
    },
    commands: [
      "auth",
      "login",
      "logout",
      "me",
      "account",
      "assets",
      "avatars",
      "avatar-videos",
      "catalog",
      "doctor",
      "health",
      "jobs",
      "skills",
      "tools",
      "balance",
      "usage",
      "update",
      "version",
    ],
    coming_soon: [mcpComingSoonStatus()],
  });
  process.exit(0);
}

registerAuthCommands(program);
registerAccountCommand(program);
registerAssetsCommand(program);
registerAvatarsCommand(program);
registerAvatarVideosCommand(program);
registerCatalogCommand(program);
registerDoctorCommand(program);
registerHealthCommand(program);
registerModelsCommand(program);
registerJobsCommand(program);
registerFilesCommand(program);
registerUsageCommand(program);
registerMcpCommand(program);
registerSetupCommand(program);
registerSkillsCommand(program);
registerToolsCommand(program);
registerUpdateCommand(program);
registerVersionCommand(program);

function shouldPrintRootHelpBanner(argv: string[]) {
  if (jsonRequested) return false;
  if (argv.includes("--version") || argv.includes("-V")) return false;
  if (argv.includes("--help") || argv.includes("-h")) return true;
  return argv.slice(2).length === 0;
}

function shouldPrintRootHelpOnly(argv: string[]) {
  if (jsonRequested) return false;
  return argv.slice(2).length === 0;
}

try {
  if (shouldPrintRootHelpBanner(process.argv)) {
    const banner = helpBanner(process.stdout, { force: true });
    if (banner) process.stdout.write(`${banner}\n`);
  }
  if (shouldPrintRootHelpOnly(process.argv)) {
    program.outputHelp();
    process.exit(0);
  }
  await program.parseAsync(process.argv);
} catch (error) {
  if (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" ||
      error.code === "commander.version" ||
      error.code === "commander.help")
  ) {
    process.exit(0);
  }
  emitError(
    error instanceof CommanderError ? commanderErrorToCliError(error) : error,
    { json: jsonRequested },
  );
  process.exit(1);
}

function commanderErrorToCliError(error: CommanderError) {
  return new CliError(stripCommanderPrefix(error.message), {
    code: "invalid_argument",
    details: {
      commander_code: error.code,
    },
  });
}

function stripCommanderPrefix(message: string) {
  return message.replace(/^error:\s*/iu, "").trim() || "Invalid command.";
}

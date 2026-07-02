import { Command } from "commander";
import { CliError } from "../lib/errors.js";
import { showSubcommandHelp } from "../lib/command.js";

function filesUnavailable(): never {
  throw new CliError("Files are not available in the current sume.com API.", {
    code: "not_implemented",
    hint: "Use catalog list to inspect available API capabilities.",
  });
}

export function registerFilesCommand(program: Command) {
  const files = program
    .command("files", { hidden: true })
    .description("Files are not available in the current sume.com API.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  files
    .command("list")
    .description("Not implemented.")
    .action(filesUnavailable);

  files
    .command("get")
    .description("Not implemented.")
    .argument("<file_id>", "File id.")
    .action(filesUnavailable);
}

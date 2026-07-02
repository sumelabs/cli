import { Command } from "commander";
import { createClient, getMode, showSubcommandHelp } from "../lib/command.js";
import { renderResult } from "../lib/render.js";

export function registerModelsCommand(program: Command) {
  const models = program
    .command("models", { hidden: true })
    .description("Deprecated alias for catalog.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  models
    .command("list")
    .description("Deprecated alias for catalog list.")
    .option("--kind <kind>", "Ignored deprecated model filter.")
    .action(async (_options: { kind?: string }, command: Command) => {
      const result = await createClient().get("/catalog");
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Endpoint", "/catalog"],
          ["Note", "models list is deprecated; use catalog list."],
        ],
      });
    });
}

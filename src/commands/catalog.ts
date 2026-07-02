import { Command } from "commander";
import { createClient, getMode, showSubcommandHelp } from "../lib/command.js";
import { renderResult } from "../lib/render.js";

export function registerCatalogCommand(program: Command) {
  const catalog = program
    .command("catalog")
    .description("Discover supported Sume API capabilities.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  catalog
    .command("list")
    .description("List public API capabilities.")
    .action(async (_options, command: Command) => {
      const result = await createClient().get("/catalog");
      renderResult(result, {
        json: getMode(command).json,
        human: [["Endpoint", "/catalog"]],
      });
    });
}

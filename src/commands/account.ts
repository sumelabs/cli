import { Command } from "commander";
import { createClient, getMode, showSubcommandHelp } from "../lib/command.js";
import { renderResult } from "../lib/render.js";

export function registerAccountCommand(program: Command) {
  program
    .command("me")
    .description("Read account information for the configured API key.")
    .action(async (_options, command: Command) => {
      const result = await createClient().get("/me");
      renderResult(result, {
        json: getMode(command).json,
        human: [["Endpoint", "/me"]],
      });
    });

  const account = program
    .command("account")
    .description("Inspect Sume account context.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "get" }),
    );

  account
    .command("get")
    .description("Read account information for the configured API key.")
    .action(async (_options, command: Command) => {
      const result = await createClient().get("/me");
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Account", "configured"],
          ["Endpoint", "/me"],
        ],
      });
    });

  program
    .command("balance")
    .description("Read USD-denominated available API balance.")
    .action(async (_options, command: Command) => {
      const result = await createClient().get("/balance");
      renderResult(result, {
        json: getMode(command).json,
        human: [
          ["Endpoint", "/balance"],
          ["Balance", "available"],
        ],
      });
    });
}

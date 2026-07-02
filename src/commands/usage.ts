import { Command } from "commander";
import {
  createClient,
  getMode,
  optionalPositiveInteger,
  showSubcommandHelp,
} from "../lib/command.js";
import { renderResult } from "../lib/render.js";

export function registerUsageCommand(program: Command) {
  const usage = program
    .command("usage")
    .description("Read API usage ledger entries.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "get" }),
    );

  usage
    .command("get")
    .description("Read usage ledger entries.")
    .option("--limit <n>", "Maximum number of usage entries.", "20")
    .option("--cursor <cursor>", "Opaque pagination cursor.")
    .action(
      async (
        options: { cursor?: string; limit?: string },
        command: Command,
      ) => {
        const limit = optionalPositiveInteger(options.limit, "limit");
        const result = await createClient().get("/usage", {
          query: { cursor: options.cursor, limit },
        });
        renderResult(result, {
          json: getMode(command).json,
          human: [
            ["Endpoint", "/usage"],
            ["Limit", limit],
          ],
        });
      },
    );
}

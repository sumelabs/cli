import { Command } from "commander";
import { getMode } from "../lib/command.js";
import { renderResult } from "../lib/render.js";
import { VERSION } from "../lib/version.js";
import { section, statusText } from "../lib/ui.js";

export function registerVersionCommand(program: Command) {
  program
    .command("version")
    .description("Print Sume CLI version.")
    .action((_options, command: Command) => {
      renderResult(
        {
          object: "version",
          version: VERSION,
          status: "current",
        },
        {
          json: getMode(command).json,
          human: [
            section("Version"),
            ["Current", VERSION],
            ["Status", statusText("current")],
          ],
        },
      );
    });
}

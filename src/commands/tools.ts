import { Command } from "commander";
import { getMode, requireString, showSubcommandHelp } from "../lib/command.js";
import { CliError } from "../lib/errors.js";
import { getToolSchema, listToolSchemas } from "../lib/tool-registry.js";
import { renderResult } from "../lib/render.js";

export function registerToolsCommand(program: Command) {
  const tools = program
    .command("tools")
    .description("Discover Sume CLI command schemas.")
    .action((_options, command: Command) =>
      showSubcommandHelp(command, { defaultSubcommand: "list" }),
    );

  tools
    .command("list")
    .description("List agent-facing CLI command schemas with safety metadata.")
    .action((_options, command: Command) => {
      renderResult(
        {
          tools: listToolSchemas(),
          count: listToolSchemas().length,
        },
        {
          json: getMode(command).json,
          human: listToolSchemas().map(
            (tool) =>
              [
                tool.name,
                tool.safety.read_only ? "read-only" : "requires confirmation",
              ] as [string, unknown],
          ),
        },
      );
    });

  tools
    .command("schema")
    .description("Show one CLI command schema and safety contract.")
    .argument("<name>", "Tool name, for example jobs.result.")
    .action((name: string, _options, command: Command) => {
      const tool = getToolSchema(requireString(name, "name"));
      if (!tool) {
        throw new CliError(`Unknown tool schema: ${name}`, {
          code: "tool_schema_not_found",
          hint: "Run sume tools list --json to discover available tools.",
        });
      }
      renderResult(tool, {
        json: getMode(command).json,
        human: [
          ["Name", tool.name],
          ["Command", tool.command],
          ["Safety", tool.safety.read_only ? "read-only" : "requires confirmation"],
        ],
      });
    });
}

import { Command } from "commander";
import { agentSetupNotLaunchedError } from "../lib/mcp-launch-status.js";
import { supportedMcpClientAgents } from "../lib/mcp-client-config.js";

type SetupAgentOptions = {
  agent?: string;
  dryRun?: boolean;
};

export function registerSetupCommand(program: Command) {
  const setup = program
    .command("setup", { hidden: true })
    .description("Sume agent setup is coming soon.")
    .action(() => {
      throw agentSetupNotLaunchedError();
    });

  setup
    .command("agent")
    .description("Sume agent setup is coming soon.")
    .requiredOption(
      "--agent <agent>",
      `Future agent client. Supported: ${supportedMcpClientAgents().join(", ")}.`,
    )
    .option("--dry-run", "Preview setup without writing client config.")
    .action((_options: SetupAgentOptions) => {
      throw agentSetupNotLaunchedError();
    });
}

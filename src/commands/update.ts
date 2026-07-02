import { Command, Option } from "commander";
import { getMode } from "../lib/command.js";
import { CliError } from "../lib/errors.js";
import { renderResult } from "../lib/render.js";
import { command, section, statusText } from "../lib/ui.js";
import { VERSION } from "../lib/version.js";

const DEFAULT_LATEST_RELEASE_URL =
  "https://github.com/sumelabs/cli/releases/latest/download/manifest.json";

type UpdateOptions = {
  check?: boolean;
  latestUrl?: string;
};

type UpdateInfo = {
  current_version: string;
  install_command: string;
  latest_release_url: string | null;
  latest_version: string;
  object: "update_check";
  pinned_install_command: string;
  update_available: boolean;
};

export function registerUpdateCommand(program: Command) {
  program
    .command("update")
    .description("Check for a newer Sume CLI release and print safe update guidance.")
    .option("--check", "Check latest release without modifying local files.")
    .addOption(
      new Option("--latest-url <url>", "Latest release metadata URL override.").hideHelp(),
    )
    .action(async (options: UpdateOptions, commandInstance: Command) => {
      const info = await readUpdateInfo(options);
      renderResult(info, {
        json: getMode(commandInstance).json,
        human: updateHuman(info),
      });
    });
}

async function readUpdateInfo(options: UpdateOptions): Promise<UpdateInfo> {
  const latest = await readLatestRelease(options.latestUrl ?? DEFAULT_LATEST_RELEASE_URL);
  const updateAvailable = compareVersions(latest.version, VERSION) > 0;
  return {
    current_version: VERSION,
    install_command: installCommand(),
    latest_release_url: latest.url ?? null,
    latest_version: latest.version,
    object: "update_check",
    pinned_install_command: pinnedInstallCommand(latest.version),
    update_available: updateAvailable,
  };
}

async function readLatestRelease(url: string) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `sume-cli/${VERSION}`,
      },
    });
  } catch (error) {
    throw new CliError("Unable to check the latest Sume CLI release.", {
      code: "update_check_failed",
      details: error instanceof Error ? error.message : String(error),
      hint: "Use the hosted installer directly: curl https://cli.sume.com/install -fsS | bash",
    });
  }
  if (!response.ok) {
    throw new CliError(`Unable to check latest release: HTTP ${response.status}`, {
      code: "update_check_failed",
      status: response.status,
    });
  }
  const body = await response.json() as Record<string, unknown>;
  const tagName =
    readString(body.version) ??
    readString(body.tag) ??
    readString(body.tag_name) ??
    readString(body.name);
  if (!tagName) {
    throw new CliError("Latest release response did not include a version tag.", {
      code: "update_check_failed",
    });
  }
  return {
    url: readString(body.url) ?? readString(body.html_url),
    version: normalizeVersion(tagName),
  };
}

function updateHuman(info: UpdateInfo) {
  return [
    section("Update"),
    ["Current", info.current_version] as [string, unknown],
    ["Latest", info.latest_version] as [string, unknown],
    [
      "Status",
      statusText(info.update_available ? "update available" : "current"),
    ] as [string, unknown],
    info.update_available
      ? `Run ${command(info.pinned_install_command)} to install the latest release.`
      : `No update needed. Reinstall any time with ${command(info.install_command)}.`,
    "The CLI does not overwrite the running binary in place; the hosted installer verifies release checksums.",
  ];
}

function installCommand() {
  return process.platform === "win32"
    ? "irm https://cli.sume.com/install.ps1 | iex"
    : "curl https://cli.sume.com/install -fsS | bash";
}

function pinnedInstallCommand(version: string) {
  return process.platform === "win32"
    ? `$env:SUME_VERSION=\"${version}\"; irm https://cli.sume.com/install.ps1 | iex`
    : `SUME_VERSION=${version} curl https://cli.sume.com/install -fsS | bash`;
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/u, "");
}

function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersion(value: string) {
  return normalizeVersion(value)
    .split(/[.-]/u)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

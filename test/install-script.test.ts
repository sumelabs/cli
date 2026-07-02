import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectInstallerPlatform,
  serveInstallScript,
} from "../web/lib/install";
import { findReleaseAsset, loadReleaseManifest } from "../web/lib/releases";

let dir: string;

const fakeBinary = `#!/bin/sh
echo 9.9.9
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sume-cli-install-test-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function writeExecutable(file: string, content: string) {
  fs.writeFileSync(file, content, { mode: 0o755 });
}

function writeFakeCurl(binDir: string, checksum = sha256(fakeBinary)) {
  const manifest = JSON.stringify({
    object: "sume_cli_release",
    version: "9.9.9",
    tag: "v9.9.9",
    assets: {
      "sume-darwin-arm64": {
        name: "sume-darwin-arm64",
        platform: "darwin-arm64",
        url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/sume-darwin-arm64",
        sha256: checksum,
        size: fakeBinary.length,
      },
      "sume-darwin-x64": {
        name: "sume-darwin-x64",
        platform: "darwin-x64",
        url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/sume-darwin-x64",
        sha256: checksum,
        size: fakeBinary.length,
      },
      "sume-linux-arm64": {
        name: "sume-linux-arm64",
        platform: "linux-arm64",
        url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/sume-linux-arm64",
        sha256: checksum,
        size: fakeBinary.length,
      },
      "sume-linux-x64": {
        name: "sume-linux-x64",
        platform: "linux-x64",
        url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/sume-linux-x64",
        sha256: checksum,
        size: fakeBinary.length,
      },
    },
    checksums: {
      name: "checksums.txt",
      platform: "checksums",
      url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/checksums.txt",
      sha256: checksum,
      size: 1,
    },
  });
  const curl = path.join(binDir, "curl");
  writeExecutable(
    curl,
    `#!/bin/sh
set -eu
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

case "$url" in
  */download/v9.9.9/manifest.json | */latest/download/manifest.json)
    printf '${manifest}\\n'
    ;;
  *)
    cat > "$out" <<'EOF'
${fakeBinary}EOF
    chmod +x "$out"
    ;;
esac
`,
  );
}

function runInstaller(extraEnv: Record<string, string> = {}) {
  const fakeBin = path.join(dir, "fake-bin");
  const home = path.join(dir, "home");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  writeFakeCurl(fakeBin, extraEnv.FAKE_CHECKSUM ?? sha256(fakeBinary));

  return spawnSync("bash", ["install.sh"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: [fakeBin, "/usr/bin", "/bin"].join(":"),
      SUME_DIR: path.join(home, ".sume-com"),
      SUME_VERSION: "9.9.9",
      ...extraEnv,
    },
  });
}

describe("install.sh", () => {
  it("installs the platform binary with checksum verification", () => {
    const result = runInstaller();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Sume CLI installed at");

    const installed = path.join(dir, "home", ".sume-com", "bin", "sume");
    expect(fs.existsSync(installed)).toBe(true);
    expect(fs.statSync(installed).mode & 0o111).not.toBe(0);
  });

  it("does not silently overwrite an existing sume found on PATH", () => {
    const existing = path.join(dir, "existing-bin");
    fs.mkdirSync(existing, { recursive: true });
    writeExecutable(path.join(existing, "sume"), "#!/bin/sh\necho old\n");

    const fakeBin = path.join(dir, "fake-bin");
    const home = path.join(dir, "home");
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    writeFakeCurl(fakeBin);

    const result = spawnSync("bash", ["install.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: [fakeBin, existing, "/usr/bin", "/bin"].join(":"),
        SUME_DIR: path.join(home, ".sume-com"),
        SUME_VERSION: "9.9.9",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Found an existing sume");
    expect(fs.readFileSync(path.join(existing, "sume"), "utf8")).toContain(
      "old",
    );
  });

  it("prints PATH guidance that prefers the new install over an older local binary", () => {
    const fakeBin = path.join(dir, "fake-bin");
    const home = path.join(dir, "home");
    const localBin = path.join(home, ".local", "bin");
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(localBin, { recursive: true });
    writeFakeCurl(fakeBin);
    writeExecutable(path.join(localBin, "sume"), "#!/bin/sh\necho old\n");

    const sumeDir = path.join(home, ".sume-com");
    const result = spawnSync("bash", ["install.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: [fakeBin, localBin, "/usr/bin", "/bin"].join(":"),
        SUME_DIR: sumeDir,
        SUME_VERSION: "9.9.9",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`Did not overwrite an existing ${localBin}/sume`);
    expect(result.stdout).toContain(
      `export PATH="${path.join(sumeDir, "bin")}:$HOME/.local/bin:$PATH"`,
    );
    expect(result.stdout).not.toContain(
      `export PATH="$HOME/.local/bin:${path.join(sumeDir, "bin")}:$PATH"`,
    );
  });

  it("fails closed on checksum mismatch", () => {
    const result = runInstaller({ FAKE_CHECKSUM: "0".repeat(64) });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Checksum verification failed");
  });
});

describe("install route helpers", () => {
  it("detects the installer platform from the user agent", () => {
    expect(detectInstallerPlatform("curl/8.0")).toBe("sh");
    expect(detectInstallerPlatform("PowerShell/7.4")).toBe("ps1");
    expect(detectInstallerPlatform("WindowsPowerShell")).toBe("ps1");
  });

  it("fails closed when no local installer script is available", async () => {
    const response = await serveInstallScript("sh", {
      scriptLoader: async () => null,
    });

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("install script unavailable\n");
  });

  it("serves a local installer script", async () => {
    const response = await serveInstallScript("sh", {
      scriptLoader: async () => "#!/usr/bin/env bash\n",
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("#!/usr/bin/env bash\n");
  });
});

describe("release manifest helpers", () => {
  it("loads a GitHub Release manifest and finds assets", async () => {
    const manifest = {
      object: "sume_cli_release",
      version: "9.9.9",
      tag: "v9.9.9",
      checksums: {
        name: "checksums.txt",
        platform: "checksums",
        url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/checksums.txt",
        sha256: "a".repeat(64),
        size: 100,
      },
      assets: {
        "sume-darwin-arm64": {
          name: "sume-darwin-arm64",
          platform: "darwin-arm64",
          url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/sume-darwin-arm64",
          sha256: "b".repeat(64),
          size: 1000,
        },
      },
    };

    const release = await loadReleaseManifest("latest.json", {
      fetcher: async (input) => {
        expect(String(input)).toBe(
          "https://github.com/sumelabs/cli/releases/latest/download/manifest.json",
        );
        return Response.json(manifest);
      },
    });

    expect(release.version).toBe("9.9.9");
    expect(findReleaseAsset(release, "sume-darwin-arm64")).toMatchObject({
      url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/sume-darwin-arm64",
      sha256: "b".repeat(64),
    });
    expect(findReleaseAsset(release, "checksums.txt")).toMatchObject({
      url: "https://github.com/sumelabs/cli/releases/download/v9.9.9/checksums.txt",
    });
  });
});

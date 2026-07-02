# Sume CLI

Agent-first CLI tooling for the future `sume.com` public API platform.

This repository contains the public CLI for the `sume.com` developer platform.
It follows these product boundaries:

- thin CLI wrappers over public API endpoints;
- stable JSON for agents and scripts;
- explicit API-key configuration;
- no direct dependency on app internals, databases, queues, or provider APIs.

## Status

This is an initial developer CLI for the current `sume.com` public API surface.
It supports account verification, catalog discovery, job status inspection,
Avatar 1.0 model runs, and Avatar Video 1.0 model runs against the current paid
`api.sume.com` platform API. Submit routes can return honest configuration,
billing, validation, or provider errors; use job status/events/result commands
for recovery.

## Install

Install the current native binary with the hosted installer:

```bash
curl https://cli.sume.com/install -fsS | bash
```

For Windows PowerShell:

```powershell
irm https://cli.sume.com/install.ps1 | iex
```

The installer downloads the latest Sume CLI release binary for your platform
from GitHub Releases, verifies it with the release manifest checksum, installs it under
`~/.sume-com/bin`, and reports clearly if another `sume` binary already appears
earlier on your `PATH`.

For direct binary installs, use GitHub Releases:

```bash
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
curl -fsSL "https://github.com/sumelabs/cli/releases/latest/download/sume-${OS}-${ARCH}" -o /tmp/sume
chmod +x /tmp/sume
sudo mv /tmp/sume /usr/local/bin/sume
```

Release assets are published as `sume-darwin-arm64`, `sume-darwin-x64`,
`sume-linux-arm64`, `sume-linux-x64`, and `sume-windows-x64.exe`, with
`checksums.txt` and `manifest.json` available through GitHub Releases. For pinned
installs, set `SUME_VERSION` to a release such as `0.1.6`.

## Update

Check the latest public release without modifying local files:

```bash
sume update --check
```

The command reports the current version, latest release version, and the
checksum-verifying hosted installer command to run. It does not overwrite the
running binary in place.

## Install For Development

```bash
pnpm install
pnpm run build
pnpm dev -- --help
```

Build a local standalone binary when needed:

```bash
pnpm run build:binary
./dist/sume --version
```

## Release Workflow

The CLI source version must stay synchronized in `package.json` and
`src/lib/version.ts`; CI runs `pnpm run version:check` to prevent drift.

The GitHub Release workflow can be run as a dry run before publishing:

```bash
gh workflow run release.yml -f version=0.1.0 -f dry_run=true
```

Non-dry-run releases build platform binaries, smoke the generated CLI, publish
checksums, and create a GitHub Release for the requested version/tag.

## Configure Auth

Use browser login for the default flow. The CLI opens `app.sume.com`, waits for
approval, then stores a one-time API key returned by the platform:

```bash
sume login
sume auth status
```

For remote or headless terminals, print the approval URL instead:

```bash
sume login --no-browser
```

Manual API-key setup remains available:

```bash
sume auth setup --api-key "$SUME_API_KEY"
```

Environment variables are also supported:

```bash
export SUME_API_KEY="..."
export SUME_API_BASE_URL="https://api.sume.com/v1"
export SUME_APP_BASE_URL="https://app.sume.com"
export SUME_API_AUTH_MODE="x-api-key"
```

For the production API, the CLI also accepts `https://api.sume.com` and
normalizes it to `https://api.sume.com/v1` for versioned API commands. Custom
and localhost API bases are preserved as configured for development and tests.

`x-api-key` is the default and recommended auth mode for the current
`api.sume.com` contract. `SUME_API_AUTH_MODE=bearer` is supported for clients
that need `Authorization: Bearer <key>`.

Local config is stored under `~/.sume-com/config.json` by default. Tests can
override this with `SUME_CONFIG_DIR`. `SUME_APP_BASE_URL` or
`sume login --app-url <url>` can point browser login at a local app server.

## Commands

```bash
sume me
sume account get
sume balance
sume usage get --limit 20
sume skills list --json
sume skills install sume --json
sume avatars create --confirm-submit --avatar-handle presenter --prompt "A friendly presenter"
sume avatars create --confirm-submit --type photo --avatar-handle photo_presenter --image-url https://example.com/person.png --json
sume avatars batch plan ./avatars.batch.json --json
sume avatars batch create ./avatars.batch.json --state-file ./avatars.state.json --confirm-paid --json
sume avatars list --handle presenter --status ready --limit 10
sume avatars get <avatar_id> --agent --json
sume avatar-videos create --confirm-submit --script "Say hello" --avatar-handle presenter
sume avatar-videos batch plan ./videos.batch.json --json
sume avatar-videos batch create ./videos.batch.json --state-file ./videos.state.json --confirm-paid --json
sume avatar-videos list --agent --json
sume avatar-videos get <avatar_video_id> --agent --json
sume catalog list
sume health
sume health v1
sume doctor --agent --json
sume jobs list
sume jobs list --agent --json
sume jobs get <job_id> --agent --json
sume jobs status <job_id> --agent --json
sume jobs events <job_id> --agent --json
sume jobs result <job_id> --agent --json
sume jobs download <job_id> --output-dir ./outputs --json
sume jobs cancel <job_id> --confirm-submit --agent --json
sume tools list --json
sume tools schema jobs.result --json
sume tools schema avatars.create_photo_url --json
sume version
```

Use `--json` for stable machine-readable output:

```bash
sume catalog list --json
```

Use `--agent` on job recovery commands when an agent or automation is reading
outputs. Agent mode redacts URL and sensitive account/workspace fields while
preserving status, type, counts, and next-step guidance.

`sume doctor --agent --json` is a local readiness check. It does not call the
API; it reports version, auth source, API base URL, safety gates, and tool
counts.

`sume tools list --json` and `sume tools schema <name> --json` expose the
current agent-facing CLI command contracts, safety metadata, confirmation
requirements, and launch status metadata. `input_schema` describes CLI flags.
MCP fields are reported as not launched yet in this public CLI release.

Supported API command groups call only current `api.sume.com` API routes:

- `GET /v1/balance`
- `GET /v1/usage`
- `POST /v1/models/sume/avatar/v1.0/runs`
- `POST /v1/models/sume/avatar-video/v1.0/runs`
- `GET /v1/avatars`
- `GET /v1/avatars/:id`
- `GET /v1/avatar-videos`
- `GET /v1/avatar-videos/:id`
- `GET /v1/jobs`
- `GET /v1/jobs/:id`
- `GET /v1/jobs/:id/status`
- `GET /v1/jobs/:id/result`
- `GET /v1/jobs/:id/events`
- `POST /v1/jobs/:id/cancel`

Advanced compatibility asset commands still exist for controlled internal or
agent workflows, but `/v1/assets/*` is hidden from the launch OpenAPI/catalog
and is not the primary upload path. Launch generation requests are URL-first:
use `--image-url`, `--product-image`, and `--scene-image-url` with stable public
HTTPS URLs. The proposed public `POST /v1/uploads` helper is deferred until the
API implements it.

Avatar and avatar-video submit commands support `--payload-json` or
`--payload-file` for exact request bodies, `--idempotency-key`,
`--mode async|sync|subscribe|webhook`, `--webhook-url`, and
`--wait-timeout-seconds 0..30`. Asset registration supports exact payloads and
`--idempotency-key`, but it does not create a generation job.
Avatar-video scripts are estimated locally and by the API; accepted target
duration is 4-60 seconds inclusive.

`sume avatars create` defaults to `sume/avatar/v1.0`. `type` means the avatar
input kind (`prompt`, `photo`, or `props`). Launch-shaped requests use
`avatar_handle` plus an `input` union; the CLI exposes that as
`--avatar-handle` and type-specific fields. `--handle` remains a short alias for
`--avatar-handle`.

Photo avatar creation currently accepts a public image URL:

```bash
sume avatars create \
  --confirm-paid \
  --type photo \
  --avatar-handle photo_presenter \
  --image-url https://example.com/reference.jpg \
  --json
```

Local file upload for Avatar creation will be restored as a URL-first helper
after the public `/v1/uploads` contract is available. Until then, use a public
HTTPS image URL for `--image-url`; do not pass asset ids or signed URLs unless
the OpenAPI schema explicitly accepts them.

All write commands require explicit confirmation before they create resources or
queue jobs. Use `--confirm-submit` after the user approves the write action, or
`--confirm-paid` when Sume generation is enabled and the request may spend credits.

Use `--agent --json` on submit commands when an agent is reading the response.
Agent mode redacts URL-like fields and adds next-step guidance for
`sume jobs watch <job_id> --agent --json` and
`sume jobs result <job_id> --agent --json`.

For natural creative prompt routing, see
[docs/agent-workflows.md](docs/agent-workflows.md). For local bundled skill
setup, see [docs/agent-skills.md](docs/agent-skills.md). The current public API
launch surface supports Avatar 1.0, Avatar Video 1.0, jobs, account, balance,
catalog, and usage. Agents should not invent generic image/video generation, raw
provider-model, brand, ads, UGC, billing-write, file, or asset-search commands
until those routes exist in the `sume.com` OpenAPI/catalog.

Hidden compatibility commands such as `sume models list` are kept only as
aliases where they can safely call the current API. Unsupported surfaces such as
files fail locally with a `not_implemented` error instead of calling nonexistent
API routes.

## Agent Skills

Bundled agent skills live under `agent/` and can be listed, exported, and
installed locally:

```bash
sume skills list --json
sume skills export sume-avatar-video --json
sume skills install sume --json
sume skills install sume-assets --json
```

The bundled skills are current `api.sume.com` packs: `sume`, `sume-tools`,
`sume-assets`, `sume-avatar`, and `sume-avatar-video`. They document auth,
redaction, Avatar 1.0, Avatar Video 1.0, batch planning, jobs, balance, usage,
schema discovery, and advanced compatibility asset handling. They explicitly exclude
old `sume.so` Brand, Ads, Face Swap, generic generation, raw provider,
billing-write, and file workflows.

## MCP

Sume MCP is coming soon and is not part of this public CLI launch release yet.
Use direct CLI commands today for auth, schema discovery, Avatar, Avatar Video,
jobs, balance, and usage workflows.

The open-source repository may contain MCP implementation code while the
capability is being prepared. Public MCP setup and server startup are not
launched yet, and the CLI does not write MCP client config in this release.

## Website

The `web/` app is intentionally minimal: a `cli.sume.com` page that copies the
current install command and serves installer scripts. Release binaries are
hosted by GitHub Releases, not Vercel.

```bash
cd web
pnpm install
pnpm run check
```

The website install command should match the GitHub Release-backed installer.
Do not point `cli.sume.com` at npm or raw GitHub source URLs.

## Security

- Do not commit API keys, tokens, signed URLs, or private media URLs.
- Do not log full secrets or raw authorization headers.
- Run `pnpm run secrets:check` before pushing.
- The CLI should call public `sume.com` APIs only.

## Architecture

See [docs/architecture.md](docs/architecture.md).

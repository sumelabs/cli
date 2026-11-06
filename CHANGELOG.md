# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- `--version` prints the version at any depth (`sume run --version`), as `--help` does. `--help` wins when both are given.
- The command names sume.com/docs/cli uses work: `sume catalog list` runs `sume models` (with a note), `sume models list` lists every model instead of filtering by "list", and `sume jobs result <job>` is `sume jobs get <job>`.

### Added

- `sume login`: the same Sume sign-in as the hosted MCP. A browser opens (OAuth with PKCE on a loopback port), or `--device` prints a code to approve on any device, which is also the default with no terminal. The sign-in refreshes on its own, one refresh at a time across parallel commands, and retries a request once when the API refuses an expired token. `--with-key` (stdin) or `--api-key` saves an API key instead.
- `sume logout` revokes the sign-in on the server, then forgets it and any saved key; `auth logout` does the same and keeps its `removed` field. `sume auth token` prints a current access token.
- `sume workspaces list` and `sume workspaces select <WORKSPACE>` (by id or exact name): a sign-in can switch the workspace runs bill. An API key cannot, and says how to sign in instead.
- `auth status` and `doctor` report a sign-in (`signed_in`, `session`, `key_source: "session"` in JSON).

- `sume balance`, `sume usage list` (also `usage get`) and `sume account get` (also `sume me`): what the workspace can spend, what recent jobs cost, and which workspace and key the CLI uses, from `GET /v1/balance`, `/v1/usage`, `/v1/me` and `/v1/workspaces`.
- `auth status` shows the workspace and its balance (`workspace` and `balance` in `--json`). `doctor` names the workspace and adds a `Balance` check that warns when there is nothing to spend.
- `run` and `upload` say when the key comes from `./.env`, and which workspace it bills.

### Fixed

- A run whose price depends on a local file (lip-sync speech, a reference clip) is priced from the uploaded file: `run` uploads it first, then checks `--max-usd`, instead of refusing with "the price cannot be checked". `estimate` and `run --dry-run` name the file and the `sume upload` command, instead of the API's "host name does not exist" for a placeholder the CLI made up. Exit codes and error codes are unchanged.
- The request schemas match the API again (they were 2 weeks behind): 21 models such as `gpt-image-2.6`, `kling-4`, `vidu-q3-pro` and `pixverse-v6`, and 20 fields such as `project_id` work in `sume schema` and as flags (`--project-id prj_…`), with no "not a field" warning. 5 retired models are gone from the list.
- A flag that is a field of the other kind of model says so (`--seed is a field of video models; gpt-image-2 is an image model`) instead of suggesting `--set`.
- `npm run schema:check` names what moved. A release refuses stale schemas, and the weekly drift check opens or updates one `schema-drift` issue instead of only failing.

## [0.5.0] - 2026-10-20

### Added

- `sume`, the command-line client for the Sume API on sume.com. It is built from the
  source of [opensume](https://github.com/sumelabs/opensume-cli), and calls
  `https://api.sume.com` with keys from sume.com → Settings → API keys.
- `https://api.open.sume.com` is Sume Open's API: `sume doctor` fails there and
  `sume agent` warns, because sume.com keys do not work on it.

[Unreleased]: https://github.com/sumelabs/cli/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/sumelabs/cli/releases/tag/v0.5.0

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

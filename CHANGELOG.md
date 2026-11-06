# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- A run whose price depends on a local file (lip-sync speech, a reference clip) is priced from the uploaded file: `run` uploads it first, then checks `--max-usd`, instead of refusing with "the price cannot be checked". `estimate` and `run --dry-run` name the file and the `sume upload` command, instead of the API's "host name does not exist" for a placeholder the CLI made up. Exit codes and error codes are unchanged.

## [0.5.0] - 2026-10-20

### Added

- `sume`, the command-line client for the Sume API on sume.com. It is built from the
  source of [opensume](https://github.com/sumelabs/opensume-cli), and calls
  `https://api.sume.com` with keys from sume.com → Settings → API keys.
- `https://api.open.sume.com` is Sume Open's API: `sume doctor` fails there and
  `sume agent` warns, because sume.com keys do not work on it.

[Unreleased]: https://github.com/sumelabs/cli/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/sumelabs/cli/releases/tag/v0.5.0

# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-10-20

### Added

- `sume`, the command-line client for the Sume API on sume.com. It is built from the
  source of [opensume](https://github.com/sumelabs/opensume-cli), and calls
  `https://api.sume.com` with keys from sume.com → Settings → API keys.
- `https://api.open.sume.com` is Sume Open's API: `sume doctor` fails there and
  `sume agent` warns, because sume.com keys do not work on it.

[0.5.0]: https://github.com/sumelabs/cli/releases/tag/v0.5.0

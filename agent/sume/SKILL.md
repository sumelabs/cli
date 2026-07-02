---
name: sume
description: Use the Sume.com CLI safely for auth, API discovery, avatars, avatar videos, jobs, balance, usage, and choosing focused Sume skills. Use this as the entry skill for current api.sume.com workflows.
---

# Sume Skill Router

Sume CLI is a thin wrapper over the current `api.sume.com` public API. It must
not call Sume databases, internal routes, provider APIs, or old `sume.so`-only
surfaces.

## Core Rules

1. Use `sume tools list --json` and `sume tools schema <name> --json` before
   constructing writes.
2. Use `--agent --json` whenever automation reads jobs, avatars, or
   avatar videos.
3. Ask for explicit approval before `--confirm-submit` or `--confirm-paid`.
4. Do not print API keys, auth approval URLs/codes in final reports, signed
   URLs, private media URLs, storage object keys, raw provider identifiers,
   workspace/user ids, or full result URLs.
5. Use current public launch API surfaces only: account, catalog, balance,
   usage, jobs, Avatar 1.0, and Avatar Video 1.0.

## Setup

```bash
sume --version
sume auth status --json
sume doctor --agent --json
```

Use browser login when the browser is local:

```bash
sume login
```

For remote/headless terminals, use a short-lived background login process and
show the URL/code only to the requesting user. See `references/safety.md` for
the exact pattern.

## Routing

- Use `sume-tools` for schema discovery and skill maintenance.
- Use `sume-avatar` for creating several avatars and choosing a ready avatar.
- Use `sume-avatar-video` for making videos from selected avatars and reading
  metadata/result state.
- Use `sume-assets` only for explicitly requested advanced compatibility asset
  workflows; launch generation inputs should be stable public HTTPS URLs.

Read `references/safety.md` for auth, paid/write gates, and redaction rules.
Read `references/eval-scenarios.md` when validating agent behavior.

Sume MCP is coming soon and is not part of this public CLI launch release yet.
Use direct CLI commands today.

## Not For

Do not use old `sume.so` Brand, Ads, Face Swap, generic image/video generation,
raw provider model, billing-write, file, or asset-search workflows unless they
appear in the current public `api.sume.com` catalog and tool schemas.

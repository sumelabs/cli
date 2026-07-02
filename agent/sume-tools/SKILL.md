---
name: sume-tools
description: Configure Sume.com CLI/MCP for agents, discover tool schemas, install or export bundled Sume skills, inspect balance/usage, and choose safe public-api workflows.
---

# Sume Tools

Use this skill for setup, MCP toolset selection, schema discovery, and local
skill maintenance.

## Discovery

```bash
sume setup agent --agent codex
sume mcp doctor --json
sume doctor --agent --json
sume tools list --json
sume tools schema avatars.create --json
sume tools schema avatars.create_photo_url --json
sume tools schema avatar-videos.create --json
sume balance --json
sume usage get --json
```

## Skill Maintenance

```bash
sume skills list --json
sume skills install sume --json
sume skills install sume-avatar --json
sume skills update --json
```

Skills install into `.agents/skills/` when `.agents/` exists, otherwise
`.claude/skills/` when `.claude/` exists.

## MCP

Default MCP is read-only:

```bash
sume mcp
sume mcp install --agent codex
sume mcp doctor --agent codex --json
```

Use explicit gates only after approval:

```bash
sume mcp --toolsets jobs --allow-write
sume mcp --toolsets avatars,avatar-videos --allow-write --allow-paid
```

Paid MCP calls still require per-call `idempotency_key` and `max_spend_usd`.
Use `dry_run: true` before submitting.

Read `references/mcp-toolsets.md` before enabling non-default tools.

## Not For

Do not execute paid creation directly from this skill. Route avatar work to
`sume-avatar` and video work to `sume-avatar-video`. Route media inputs through
public HTTPS URLs unless the user explicitly asks for advanced compatibility
asset tooling.

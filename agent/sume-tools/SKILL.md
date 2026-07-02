---
name: sume-tools
description: Discover Sume.com CLI tool schemas, install or export bundled Sume skills, inspect balance/usage, and choose safe public-api workflows.
---

# Sume Tools

Use this skill for schema discovery and local skill maintenance.

## Discovery

```bash
sume doctor --agent --json
sume tools list --json
sume tools schema avatars.create --json
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

Sume MCP is coming soon and is not part of this public CLI launch release yet.
Use direct CLI commands today.

## Not For

Do not execute paid creation directly from this skill. Route avatar work to
`sume-avatar` and video work to `sume-avatar-video`. Route media inputs through
public HTTPS URLs unless the user explicitly asks for advanced compatibility
asset tooling.

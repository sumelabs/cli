# Agent Skills

Bundled skills teach agents current `api.sume.com` workflows. They are local
files shipped with the CLI, not a hosted registry.

```bash
sume skills list --json
sume skills export sume --json
sume skills install sume --json
sume skills update --json
sume skills remove sume --json
```

Install writes to `.agents/skills/<name>` when `.agents/` exists, otherwise to
`.claude/skills/<name>` when `.claude/` exists. Create one of those project
directories first so the CLI does not guess where an agent should read skills.

Bundled skills:

- `sume`: router, auth, safety, redaction, eval scenarios.
- `sume-tools`: MCP setup, schema discovery, balance/usage, skill maintenance.
- `sume-assets`: advanced compatibility asset registration/upload/download
  helpers; not the default launch media-input path.
- `sume-avatar`: Avatar 1.0 prompt/photo/props creation and batch planning.
- `sume-avatar-video`: selected-avatar video creation, batch planning, and
  metadata-aware readback.

Safe setup:

```bash
sume setup agent --agent codex
sume mcp doctor --json
sume doctor --agent --json
sume tools list --json
sume tools schema avatars.create --json
sume tools schema avatar-videos.create --json
```

Use `--confirm-submit` only after the user approves a write. Use
`--confirm-paid` only after the user approves paid generation Avatar or Avatar
Video work. Use `--agent --json` for readback that may include URLs or
workspace/account details.

Do not copy old `sume.so` Brand, Ads, Face Swap, generic generation, raw
provider, billing-write, file, or asset-search workflows into current Sume
agent setup unless those routes appear in the public `api.sume.com` catalog and
tool schemas.

# MCP Toolsets

This CLI exposes MCP tools for the current `api.sume.com` public API surface.
Do not use this CLI or MCP server for old `sume.so`-only Brand, Ads, Face Swap,
generic generation, billing-write, file, or provider-id workflows unless those
routes appear in the public `sume.com` API catalog.

## Default Read-Only Server

```bash
sume mcp
```

Set up a supported agent client with the default read-only MCP server:

```bash
sume setup agent --agent codex
sume setup agent --agent claude-code
sume setup agent --agent cursor
```

Install the read-only MCP server config for a supported client:

```bash
sume mcp install --agent codex
sume mcp install --agent claude-code
sume mcp install --agent cursor
```

Preview the generated config without writing files:

```bash
sume mcp install --agent codex --dry-run
sume mcp install --agent claude-code --dry-run
sume mcp install --agent cursor --dry-run
```

Check local MCP client readiness:

```bash
sume mcp doctor
sume mcp doctor --agent codex --json
```

Default MCP is read-only and agent-redacted. It exposes:

- `tools.list`
- `tools.schema`
- `health.service`
- `health.v1`
- `account.me`
- `balance.get`
- `usage.get`
- `catalog.list`
- `jobs.list`
- `jobs.get`
- `jobs.status`
- `jobs.events`
- `jobs.result`
- `jobs.wait`
- `avatars.list`
- `avatars.get`
- `avatars.wait`
- `avatar-videos.list`
- `avatar-videos.get`

Use `tools.list` and `tools.schema` inside MCP to inspect the same contracts
available through `sume tools list --json` and
`sume tools schema <name> --json`.
Those contracts also include CLI-only local helpers such as `skills.list`,
`assets.download`, `jobs.download`, `avatars.batch.*`, and
`avatar-videos.batch.*`; they are intentionally not MCP server tools unless a
future public API contract requires them inside MCP.

## Write-Gated Tools

Use write-gated tools only after explicit user approval:

```bash
sume mcp --toolsets account,catalog,jobs --allow-write
```

This adds:

- `jobs.cancel`

Advanced compatibility asset tools are not part of the launch default MCP
surface because `/v1/assets/*` is hidden from the launch OpenAPI/catalog. Use
them only when a user explicitly asks for that non-primary workflow:

```bash
sume mcp --toolsets assets --allow-write
```

This adds:

- `assets.create`
- `assets.upload_url`
- `assets.upload_file`
- `assets.complete`

`assets.upload_file` is the safest MCP local-upload path. It reads one supplied
local file, creates a public API signed upload URL, PUTs bytes to that URL, and
completes the asset. The signed URL, storage headers, and local absolute file
path are not returned. Local MCP uploads are limited to 512 MiB.

`assets.upload_url` returns a sensitive signed URL in raw API output, so prefer
agent-redacted MCP responses and do not echo signed URLs in final reports.

## Paid Generation Tools

Paid generation Avatar and Avatar Video submits require both write and paid
opt-ins:

```bash
sume mcp --toolsets account,catalog,jobs,avatars,avatar-videos --allow-write --allow-paid
```

This adds:

- `avatars.create`
- `avatars.create_prompt`
- `avatars.create_props`
- `avatars.create_photo_url`
- `avatar-videos.create`

These tools submit public model-run requests to `api.sume.com`; they do not
claim output is ready. Use `jobs.wait`, `jobs.status`, `jobs.events`, and
`jobs.result` for recovery and readback.

## Safety Rules

- Never pass API keys as command-line arguments.
- Do not expose signed upload/download URLs, private media URLs, provider ids,
  storage object keys, or raw auth headers in agent reports.
- Do not enable `--allow-write` or `--allow-paid` unless the user explicitly
  approved the operation.
- Use `jobs.wait` for bounded polling; it calls `/jobs/:id/status` only and does
  not start live generation work.

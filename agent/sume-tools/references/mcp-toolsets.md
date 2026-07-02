# MCP Toolsets

## Default

`sume mcp` exposes read-only, agent-redacted tools:

- `tools.list`, `tools.schema`
- `health.service`, `health.v1`
- `account.me`, `balance.get`, `usage.get`
- `catalog.list`
- `jobs.list`, `jobs.get`, `jobs.status`, `jobs.events`, `jobs.result`, `jobs.wait`
- `avatars.list`, `avatars.get`, `avatars.wait`
- `avatar-videos.list`, `avatar-videos.get`

## Write Gate

```bash
sume mcp --toolsets jobs --allow-write
```

Adds non-paid writes such as `jobs.cancel`.

Advanced compatibility asset tools are hidden from the launch OpenAPI/catalog
and are not part of default MCP. Use them only when explicitly requested:

```bash
sume mcp --toolsets assets --allow-write
```

This exposes `assets.create`, `assets.upload_url`, `assets.upload_file`,
`assets.complete`, and readback helpers.

## Paid Gate

```bash
sume mcp --toolsets avatars,avatar-videos --allow-write --allow-paid
```

Adds paid generation `avatars.create`, `avatars.create_prompt`,
`avatars.create_props`, `avatars.create_photo_url`, and `avatar-videos.create`.

Paid tool calls require per-call `idempotency_key` and `max_spend_usd`. Use
`dry_run: true` to run a non-submitting Sume cost/readiness preview without creating a job.

Use `jobs.wait` and `jobs.result` for readback. Do not ask MCP to reveal signed
URLs or private media URLs.

# Architecture

The repo is split into a small number of boundaries.

## CLI

`src/index.ts` owns command registration and global output behavior. Commands
live in `src/commands/` and should stay thin.

`src/commands/doctor.ts` is a local diagnostics surface for agents. It should
not call public API endpoints or providers; it reports local config, safety
gates, version, and current tool counts.

## Public API Client

`src/lib/api-client.ts` is the only HTTP boundary. Commands call this client
instead of hand-rolling fetch calls.

The default base URL is:

```text
https://api.sume.com/v1
```

`SUME_API_BASE_URL` and local config can override it for development.

The client defaults to the current `api.sume.com` API-key header:

```text
x-api-key: <key>
```

`SUME_API_AUTH_MODE=bearer` or local config `authMode: "bearer"` switches to
`Authorization: Bearer <key>` for compatibility with the same API contract.

Current launch-supported paths are:

- `GET /v1/health`
- `GET /me`
- `GET /catalog`
- `GET /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/status`
- `GET /jobs/:id/result`
- `GET /jobs/:id/events`
- `POST /jobs/:id/cancel`
- `POST /models/sume/avatar/v1.0/runs`
- `POST /models/sume/avatar-video/v1.0/runs`
- `GET /avatars`
- `GET /avatars/:id`
- `GET /avatar-videos`
- `GET /avatar-videos/:id`

The Avatar 1.0 and Avatar Video 1.0 model-run routes are public API operations
backed by the configured `api.sume.com` runtime. Commands must not
claim media generation has completed unless the API returns a completed
job/result. Generic image/video routes and raw provider model ids are not part
of the current public CLI surface.

CLI submit commands must require explicit confirmation before calling mutating
routes. `--confirm-submit` is the generic write gate; `--confirm-paid` is the
provider/credit-spend alias for generation submits.

Files, billing-write, brand, asset search, generic image/video generation, and
unsupported product-specific generation routes are not called by this CLI until
their `sume.com` public contracts are finalized. `/v1/assets/*` is advanced
compatibility tooling only because it is hidden from the launch
OpenAPI/catalog. Launch generation inputs are URL-first. Signed URL responses
must be redacted in agent output. MCP is coming soon and is not part of this
public CLI launch release yet.

## Agent Output And Tool Schemas

`src/lib/tool-registry.ts` is the source of truth for the current agent-facing
tool list, command examples, and safety metadata used by `sume tools`.

Tool schemas expose `input_schema` for direct CLI flags. `mcp_input_schema` is
`null` in this public launch release because MCP is coming soon and is not
launched yet. Confirmation metadata should stay explicit so agents can
distinguish read operations from writes and paid submits.

`src/lib/agent-output.ts` redacts URLs and sensitive account/workspace fields
for agent-readable job recovery and MCP responses. Raw public API passthrough
should remain available only through non-agent command modes when a human
explicitly needs the original response.

Submit and job-read tool schemas should mark that URL-like fields may appear in
raw API responses. Agent-safe CLI paths must add next-step guidance and redact
those fields before returning output to automation.

## Auth And Config

`src/lib/config.ts` reads and writes local API-key configuration. The default
location is `~/.sume-com/config.json` to avoid colliding with the existing
`sume.so` CLI config. `sume login` uses `app.sume.com` device approval to issue
and store a CLI-sourced API key; manual `sume auth setup --api-key <key>`
remains available for development and automation.

Precedence:

1. environment variables;
2. local config file;
3. defaults.

The public API base defaults to `https://api.sume.com/v1`. Browser login derives
`https://app.sume.com` from that API base unless `SUME_APP_BASE_URL` or
`--app-url` provides an explicit dashboard app origin.

## MCP

MCP is coming soon and is not part of this public CLI launch release yet.
`src/mcp/server.ts`, `src/mcp/tools.ts`, and `src/mcp/transports/stdio.ts` remain
in the open-source repository for future launch work, but the public `sume mcp`
and `sume setup agent` command paths report coming-soon status and do not start
a server or write client config.

Direct CLI commands are the supported launch surface today. `sume tools list
--json` and `sume tools schema <name> --json` expose CLI command schemas with
`mcp_input_schema: null` and `mcp.status: "coming_soon"` so agents can discover
current command contracts without treating MCP as launched.

Bundled agent skill packs live under `agent/` and ship with the npm/package
artifact. `src/lib/skills-registry.ts` lists, exports, installs, updates, and
removes those local packs for `.agents/skills` or `.claude/skills` projects.
The packs are limited to current `api.sume.com` workflows and exclude old
`sume.so`-only Brand, Ads, Face Swap, generic generation, raw provider,
billing-write, and file surfaces.

## Website

`web/` is an isolated Next app for the future `cli.sume.com` site. It should
document the CLI, MCP usage, configuration, and release/install flow without
depending on production secrets or domain configuration.

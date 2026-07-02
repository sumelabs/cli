# Sume CLI Agent Guide

These instructions apply to this repository.

## Scope

- This repo is for the future `sume.com` public API CLI and MCP tooling.
- Keep the CLI a thin wrapper over public API boundaries. Do not couple it to `sume.so`, `sume_so`, internal database tables, queues, provider APIs, or deployment services.
- Default API base URL is `https://api.sume.com/v1`.
- Use local API-key configuration and environment variables only. Never commit real credentials.

## Validation

Use the smallest relevant check first:

```bash
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run build:binary
pnpm run secrets:check
```

For website changes:

```bash
cd web
pnpm run check
```


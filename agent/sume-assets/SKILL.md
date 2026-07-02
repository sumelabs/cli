---
name: sume-assets
description: Use advanced compatibility Sume.com asset tools for approved internal/agent workflows; launch Avatar and Avatar Video inputs should use stable public HTTPS URLs directly.
---

# Sume Assets

Use this skill only when the user explicitly asks for advanced compatibility
`api.sume.com` asset tooling. `/v1/assets/*` is hidden from the launch
OpenAPI/catalog; normal Avatar and Avatar Video generation should use stable
public HTTPS URLs directly.

## Discover Contracts

```bash
sume tools schema assets.create --json
sume tools schema assets.upload_url --json
sume tools schema assets.complete --json
sume tools schema assets.download_url --json
```

## Register Public URL

```bash
sume assets create \
  --source-url https://example.com/reference.png \
  --media-type image \
  --confirm-submit \
  --agent \
  --json
```

Only register public HTTPS URLs that the user approved. The public API does not
echo the original source URL in readback.

## Direct Upload

Use `assets upload-url`, PUT bytes outside the CLI, then `assets complete`.
Never paste signed URLs into reports.

## Download

Use CLI download helpers only when the user asks for local files:

```bash
sume assets download <asset_id> --output-dir ./outputs --json
sume jobs download <job_id> --output-dir ./outputs --json
```

Read `references/media-workflows.md` for details.

## Not For

Do not use assets as the default launch upload path, and do not pass asset ids
into generation requests unless the current OpenAPI schema explicitly accepts
them. Do not use old Asset Library scene search or `uploads/presign`; those are
`sume.so`-only unless the current public catalog exposes them.

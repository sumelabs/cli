# Agent Workflows

This CLI wraps the current `sume.com` public API. Do not invent commands for
generic image/video generation, raw provider models, brand, ads, UGC, billing
writes, or file surfaces until those routes exist in the public OpenAPI/catalog.

Use this sequence for current Avatar 1.0 and Avatar Video 1.0 prompts.

## Readiness

```bash
sume doctor --agent --json
sume catalog list --json
sume tools schema jobs.watch --json
sume tools schema jobs.download --json
sume tools schema avatars.create --json
sume tools schema avatars.batch.plan --json
sume tools schema avatar-videos.create --json
sume tools schema avatar-videos.batch.plan --json
```

If auth is missing, stop and ask the user to configure an API key.

## Media Inputs

Launch model-run inputs are URL-first. Use public HTTPS URLs directly in the
fields exposed by the current OpenAPI:

- Avatar photo input: `input.image_url`
- Avatar Video product input: `product_image`
- Avatar Video scene photo input: `scene.image_url`

Do not pass asset ids into generation requests unless a current OpenAPI schema
explicitly accepts them. `/v1/assets/*` remains an advanced compatibility
workflow and is hidden from the launch OpenAPI/catalog. The simple public
`POST /v1/uploads` helper is deferred until the API implements it.

## Avatar 1.0

Create or reuse a ready avatar:

```bash
sume avatars create \
  --avatar-handle presenter \
  --prompt "A friendly presenter for skincare product demos" \
  --confirm-paid \
  --agent \
  --json

sume avatars list --handle presenter --agent --json
sume avatars get <avatar_id> --agent --json
```

The create command submits `POST /v1/models/sume/avatar/v1.0/runs`. For exact
model-run payloads, use `--payload-json` or `--payload-file`.
Photo avatar creation uses a public image URL:

```bash
sume avatars create \
  --type photo \
  --avatar-handle photo_presenter \
  --image-url https://example.com/reference.png \
  --confirm-paid \
  --agent \
  --json
```

Local file-to-avatar upload is deferred until the public URL-first upload helper
is available. Use a stable public HTTPS URL for `--image-url` until then.

For several candidate avatars, draft a local manifest and plan before paid
submission:

```bash
sume avatars batch plan ./avatars.batch.json --output-file ./avatars.plan.json --json
sume avatars batch create ./avatars.batch.json --state-file ./avatars.state.json --confirm-paid --json
sume avatars batch watch ./avatars.batch.json --state-file ./avatars.state.json --json
sume avatars batch result ./avatars.batch.json --state-file ./avatars.state.json --json
```

`batch plan` is local and does not call the API. `batch create` queues paid
paid generation jobs and uses stable per-item idempotency keys. Use
`sume avatars list --ready --agent --json` and ask the user to choose by taste.

## Avatar Video 1.0

Create an avatar video from a ready avatar. Add `--product-image` only when the
user provides a public product/reference image:

```bash
sume avatar-videos create \
  --script "This serum absorbs quickly and leaves a clean finish." \
  --avatar-handle <ready_avatar_handle> \
  --scene-prompt "Bright studio, clean counter" \
  --confirm-paid \
  --agent \
  --json
```

The create command submits `POST /v1/models/sume/avatar-video/v1.0/runs`.
Use `--avatar-handle` with a ready avatar handle. Scripts are estimated locally
and by the API; accepted target duration is 4-60 seconds inclusive.

For several scripts or scenes from one selected avatar:

```bash
sume avatar-videos batch plan ./videos.batch.json --output-file ./videos.plan.json --json
sume avatar-videos batch create ./videos.batch.json --state-file ./videos.state.json --confirm-paid --json
sume avatar-videos batch watch ./videos.batch.json --state-file ./videos.state.json --json
sume avatar-videos batch result ./videos.batch.json --state-file ./videos.state.json --json
```

After completion, use `sume avatar-videos get <avatar_video_id> --agent --json`
for resource metadata and `sume jobs result <job_id> --agent --json` for job
result readback. Summarize tags, scenes, transcript, duration, summary, and
artifact status when present.

## Follow-Up

After any submit command:

1. Capture `data.job.id` or `data.request_id` from the redacted response.
2. Poll with `sume jobs watch <job_id> --agent --json` when using the CLI.
3. Read completed output with `sume jobs result <job_id> --agent --json`.
4. Save media only on request with
   `sume jobs download <job_id> --output-dir ./outputs --json`.

Sume MCP is coming soon and is not part of this public CLI launch release yet.
Use direct CLI commands for current automation.

## Safety

- Do not run paid/write commands without explicit user approval.
- Use `--agent --json` for submit, watch, and result outputs read by agents.
- Do not echo raw signed, private, or provider media URLs in final reports.
- Reuse `--idempotency-key` for retries after timeouts or transport failures.

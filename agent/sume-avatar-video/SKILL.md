---
name: sume-avatar-video
description: Create, batch-plan, watch, and inspect Sume Avatar Video 1.0 resources from selected avatars with metadata-aware readback and safe paid gates.
---

# Sume Avatar Video

Use this skill after a ready avatar is selected.

## Discover

```bash
sume tools schema avatar-videos.create --json
sume tools schema avatar-videos.get --json
sume tools schema jobs.result --json
```

## Single Video

```bash
sume avatar-videos create \
  --avatar-handle <ready_avatar_handle> \
  --script "This serum absorbs quickly." \
  --scene-prompt "Bright clean studio" \
  --confirm-paid \
  --agent \
  --json
```

Then:

```bash
sume jobs watch <job_id> --agent --json
sume jobs result <job_id> --agent --json
sume avatar-videos get <avatar_video_id> --agent --json
```

Scripts are estimated locally and by the API; accepted target duration is 4-60
seconds inclusive. Use handles for avatar handoffs.
Add `--product-image` when the user provides a public product/reference image;
omit it for productless avatar videos.

Summarize status, artifacts, duration, tags, scenes, transcript, and summary
when present. Do not paste full media URLs.

## Batch Videos

```bash
sume avatar-videos batch plan ./avatar-videos.json --output-file ./avatar-videos.plan.json --json
sume avatar-videos batch create ./avatar-videos.json --state-file ./avatar-videos.state.json --confirm-paid --json
sume avatar-videos batch watch ./avatar-videos.json --state-file ./avatar-videos.state.json --json
sume avatar-videos batch result ./avatar-videos.json --state-file ./avatar-videos.state.json --json
```

Read `references/avatar-video-batch-manifest.md` for manifest shape.

## Not For

Do not route generic video generation, Ads, UGC Ads, Face Swap, or raw provider
model ids through this skill unless they are added to the current public
`api.sume.com` catalog.

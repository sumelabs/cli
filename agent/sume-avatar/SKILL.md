---
name: sume-avatar
description: Create, inspect, batch-plan, and select Sume Avatar 1.0 resources with safe paid gates and agent-redacted readback.
---

# Sume Avatar

Use this skill for Avatar 1.0 creation and selection.

## Discover

```bash
sume tools schema avatars.create --json
sume tools schema avatars.list --json
sume tools schema jobs.wait --json
```

## Single Avatar

```bash
sume avatars create \
  --type prompt \
  --avatar-handle presenter \
  --prompt "Friendly skincare presenter" \
  --confirm-paid \
  --agent \
  --json
```

Photo and profile-style creation are current public inputs:

```bash
sume avatars create --type photo --avatar-handle photo_ref --image-url https://example.com/person.png --confirm-paid --agent --json
sume avatars create --type props --avatar-handle profile --ethnicity Asian --sex female --age 28 --confirm-paid --agent --json
```

## Several Avatars

Plan locally first:

```bash
sume avatars batch plan ./avatars.json --output-file ./avatars.plan.json --json
```

After explicit paid approval:

```bash
sume avatars batch create ./avatars.json --state-file ./avatars.state.json --confirm-paid --json
sume avatars batch watch ./avatars.json --state-file ./avatars.state.json --json
sume avatars batch result ./avatars.json --state-file ./avatars.state.json --json
```

Use ready avatar handles with `sume-avatar-video`.

## Selection

```bash
sume avatars list --ready --agent --json
sume avatars list --handle presenter --agent --json
sume avatars get <avatar_id> --agent --json
```

Summarize name, status, creation style, artifacts count, and any taste-relevant
metadata. Do not paste raw media URLs.

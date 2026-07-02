# Sume Safety Reference

## Auth

- Prefer `sume login` only when the browser is on the same machine.
- In remote/headless terminals, avoid a long foreground login waiter because
  intermediate auth URLs/codes can be hidden until timeout or persisted in logs.
- Use a short-lived process log:

```bash
login_log="$(mktemp -t sume-login.XXXXXX.log)"
(sume login --no-browser --timeout 600 >"$login_log" 2>&1; echo $? >"$login_log.status") &
login_pid=$!
sleep 4
sed -n '1,80p' "$login_log"
```

After user approval:

```bash
wait "$login_pid"
sume auth status --json
rm -f "$login_log" "$login_log.status"
```

## Gates

- `--confirm-submit`: non-paid writes such as asset registration, upload
  completion, and job cancellation.
- `--confirm-paid`: paid generation submits such as Avatar 1.0 and Avatar Video
  1.0 creation.
- MCP `--allow-write`: exposes mutating non-paid tools.
- MCP `--allow-paid`: exposes paid generation submit tools and should be paired
  with `--allow-write` for submit actions.

## Sensitive Outputs

Never echo API keys, approval codes, signed upload/download URLs, private media
URLs, storage object keys, raw auth headers, provider ids, workspace/user ids,
or full result URLs in reports. Use `--agent --json` and summarize redacted
metadata.

## Current Public Boundary

Allowed current launch surfaces: `GET /me`, `GET /catalog`, `GET /balance`,
`GET /usage`, jobs, Avatar 1.0 model runs, Avatar Video 1.0 model runs, avatar
resources, and avatar-video resources. `/v1/assets/*` is advanced
compatibility tooling only and is hidden from the launch OpenAPI/catalog.

Excluded until public contracts exist: old Brand, Ads, Face Swap, generic
image/video generation, arbitrary file APIs, provider ids, and billing-write
operations.

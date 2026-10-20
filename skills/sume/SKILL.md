---
name: sume
description: Generate images, video, lip-sync and captions with the Sume API through the `sume` CLI. Use when the user asks to make or edit an image or a video clip, lip-sync a face to speech, burn captions into a video, compare media models or their prices, or check on a Sume generation job.
---

## sume: images and video from the Sume API

`sume` runs any Sume API model from the shell: it prices the request in dollars, waits for the job, and saves the file.

**Setup, once**

```sh
curl -fsSL https://raw.githubusercontent.com/sumelabs/cli/main/install.sh | sh
```

Windows: `irm https://raw.githubusercontent.com/sumelabs/cli/main/install.ps1 | iex`. No install, with Node 22+: put `npx -y https://github.com/sumelabs/cli/releases/latest/download/sume.tgz` where these examples say `sume`.

- Key: `SUME_API_KEY`, read from the environment or from `./.env`. A person makes it at https://www.sume.com/dashboard/api-keys. Never print it, and never paste it into a chat or a command line.
- Host: `https://api.sume.com`, the default; nothing to set. Never `https://api.open.sume.com`: that is Sume Open's API, and sume.com keys fail there.
- Check both: `sume doctor`.

**Make something**

```sh
sume models --brief                                            # pick a model: price per image or second, inputs, limits
sume run gpt-image-2 "a red kite over a beach" -q low -o out/  # waits, saves, prints the file path
sume run seedance-2-mini "a paper boat" -d 4 -r 480p --max-usd 0.50 -o out/ --json
```

- Name the model yourself: prices differ by more than 100× between models. Before a large spend, show the user `sume estimate` with the same flags (free).
- `run` prints the saved file's path. With `--json` it prints `{"job", "usd", "artifacts": [{"path", "url", "content_type"}]}`; `SUME_CLI_OUTPUT=json` does that without the flag.
- Cap the spend with `--max-usd`, or `SUME_CLI_MAX_USD` for every run. Over the cap nothing is submitted (exit 7).
- Local files work wherever a URL does (`--image ./photo.png`, `--video`, `--audio`). Every field in `sume schema <model>` is also a flag, like `--captions.style glass`.
- Long video: `--no-wait` returns the job id at once, and `sume jobs wait <job> -o out/` saves it later. After a timeout (exit 6) or Ctrl-C (130) the job keeps running: resume it with `jobs wait`. Never resubmit; a second submit is a second charge.

**When it fails**

Exit codes: 1 network or server (retry), 2 bad flags, 3 key (follow `error.hint`), 4 input refused (fix what `error.message` says), 5 job failed (refunded; `sume jobs get <job>` says why), 6 timed out, 7 balance or cap, 8 rate limit, 130 stopped by Ctrl-C or SIGTERM (the job keeps running; `jobs wait` it). Exit 1 after a finished job means a file was not saved: run the command the error prints; it fetches only the missing files. With `--json`, errors are `{"error": {"code", "message", "hint", "request_id"}}`. Every command and flag: `sume --help --json`. Docs: https://docs.sume.com/public-api

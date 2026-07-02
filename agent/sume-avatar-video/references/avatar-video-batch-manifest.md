# Avatar Video Batch Manifest

```json
{
  "defaults": {
    "avatar_handle": "ready_avatar",
    "scene_prompt": "Bright studio",
    "mode": "async"
  },
  "videos": [
    {
      "id": "hook",
      "script": "This is the quick morning skincare step."
    },
    {
      "id": "demo",
      "script": "Apply a small amount and watch it absorb.",
      "title": "Application demo"
    }
  ]
}
```

`batch plan` is local and no-provider. `batch create` is paid generation
and requires `--confirm-paid`. Use a persistent state file so reruns skip items
that already have a job id.

Scripts are estimated locally and by the API; accepted target duration is 4-60
seconds inclusive.
Add `product_image` in defaults or per-video entries only when the user provides
a public product/reference image.

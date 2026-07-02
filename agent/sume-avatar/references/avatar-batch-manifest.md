# Avatar Batch Manifest

```json
{
  "defaults": {
    "mode": "async"
  },
  "avatars": [
    {
      "id": "friendly",
      "type": "prompt",
      "avatar_handle": "friendly_presenter",
      "prompt": "Warm, direct-to-camera skincare presenter"
    },
    {
      "id": "photo",
      "type": "photo",
      "avatar_handle": "photo_reference",
      "image_url": "https://example.com/person.png"
    },
    {
      "id": "profile",
      "type": "props",
      "avatar_handle": "profile_presenter",
      "ethnicity": "Asian",
      "sex": "female",
      "age": 28
    }
  ]
}
```

`batch plan` is local and no-provider. `batch create` is paid generation
and must use `--confirm-paid`. Reruns with the same state file should not create
duplicate jobs for items that already have a job id.

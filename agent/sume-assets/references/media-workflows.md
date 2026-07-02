# Media Workflows

## Upload Safety

- Signed upload URLs and headers are temporary credentials.
- Do not send Sume API auth headers to signed storage URLs.
- Direct upload helpers should keep signed URLs internal and return only
  redacted asset metadata.

## Download Safety

- Download only into an explicit user-approved output directory.
- Download helpers should accept only URL fields returned by public Sume job or
  asset responses.
- Final reports should summarize local filenames, sizes, and counts, not remote
  URLs.

## Asset Usage

Launch model-run inputs accept URL references where the OpenAPI schema defines
media fields. `/v1/assets/*` remains an advanced compatibility workflow, not the
default public upload path. Do not assume an asset id is valid in a submit
request unless the schema says so.

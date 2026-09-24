# Local publish timing — September 22, 2026

Two instrumented read-only replays of the latest local publisher's planning and
verification path took **65.61s and 54.96s without uploading anything**. This
isolates substantial overhead already present before counting document writes,
asset transfers or embeddings. CI is excluded from this analysis.

| Phase | First replay | Second replay |
| --- | ---: | ---: |
| Parse local documents | 1.38s | 1.21s |
| Scan assets, hash bytes and derive owners | 5.87s | 5.12s |
| Initial full-manifest plan | 4.65s | 5.47s |
| Second full-manifest plan | 4.79s | 4.60s |
| Find 16 selected documents for verification | **36.77s** | **34.25s** |
| Full-manifest post-publish recheck | 12.15s | 4.30s |
| Total including small uninstrumented overhead | **65.61s** | **54.96s** |

The second planning call substitutes a dry run for the normal lock-acquiring
`/begin`. These are **read-overhead measurements**, not actual release completion
times or exact reconstructions of earlier runs. Both samples found all 16 selected
documents. No content, locks, uploads, embeddings or release state were mutated.

Verification fetched **7,011 document records in 30 sequential requests**,
transferring **116.27 MB of decoded JSON** to locate those 16 documents. The
client requested 500 rows per page and followed the returned pagination cursors.
It stopped as soon as all selected slugs had been found.

| Verification request time | First replay | Second replay |
| --- | ---: | ---: |
| Waiting for response headers | 26.18s | 21.29s |
| Reading response bodies | 10.45s | 12.83s |
| JSON parsing | 0.13s | 0.11s |

Header wait includes request upload, network latency, platform queueing, and
backend execution. Production returned no Server-Timing fields, so the current
measurements **cannot separate Convex time from the other components**. Body
bytes are decoded payload size, not compressed network traffic. Parsing is a
negligible portion; optimizing JSON parsing would not address the bottleneck.

In the second replay, the 5.12s asset scan broke down into:

- File inventory: 0.11s.
- Reparse documents for ownership: 0.44s.
- Validate/read/hash 5.38 GB of assets: **4.29s**.
- Derive ownership/visibility: 0.29s.

The three full-manifest plans took **14.38–21.60s combined**. Almost all of that
was time to response headers, rather than client serialization or body download.
The 12.15s recheck versus 4.30s on the second replay shows that network/server
variance is material; two observations do not establish p95 latency.

The next performance change should be a publisher-authenticated batch
verification endpoint keyed by the selected slugs/assets. Preserve verification
of content and visibility; eliminate the need to download unrelated page bodies.
Then make planning scoped and reuse a revision-bound plan. These two steps attack
roughly **88% of the measured read overhead**. Asset selection before hashing is
the next local improvement. Higher upload concurrency does not address these
read-only costs.

## Instrumentation added

`oncobase publish --profile <new-file.json>` (or `PUBLISH_PROFILE`) records:

- Local config, Git check, sync, document/asset scan, ownership, embeddings,
  metadata, document uploads, asset byte uploads, and API requests.
- Request serialization, time to response headers, body download and JSON parse.
- Parent IDs and monotonic offsets so concurrent durations are not mistaken for
  sequential wall time; request/response bytes, counts and status codes.
- Errors/unfinished spans without storing error text, tokens, URLs, slugs or
  content. Files are mode 0600 and cannot overwrite existing files or symlinks.
- A shared `publisherPost` helper and exported profiler for temporary publishers,
  so actual local scripts can use the same measurements as the packaged CLI.

Backend tracing now names the fixed publish routes instead of `/api/other` and
records authentication lookup, lock acquisition, document inventory, asset
inventory and existing per-Convex-call spans. It accepts the local request's
W3C traceparent. When OpenTelemetry is enabled, the server spans join that trace.
The local file is a structured profile, not an OTLP export.

After deployment, profiled requests also receive numeric Server-Timing fields
for the backend/RPC totals and inventory phases **without requiring an OTel
collector**. The client records those values alongside its own request timings.
This will expose database versus network/platform overhead instead of guessing.

The read-only probe is reproducible with:

```sh
bun apps/app/scripts/profile-local-publish.ts --site diana \
  --vault /path/to/release/obsidian \
  --files-from /tmp/document-paths.json \
  --profile /tmp/local-read-profile.json
```

The scope file is a JSON array of vault-relative Markdown paths. The probe uses
three dry-run plans and paginated verification reads, matching the relevant
parts of the latest temporary publisher. It checks lookup coverage, not source
hash equality. The production publish CLI still lacks that script's post-write
verification; profiling does not silently add it or change success semantics.

Machine-readable measurements: [local-publish-timing-2026-09-22.json](local-publish-timing-2026-09-22.json).
Detailed local profiles were saved to `/tmp/local-publish-profile-20260922-first.json`
and `/tmp/local-publish-profile-20260922-second.json`.

Validated the CLI unit suite, backend tracing tests, package build, CLI/app
typechecks, and packaged Node CLI early-exit profiling. Backend trace correlation,
numeric Server-Timing, concurrent parentage, body timing, redaction of private
data, bounded profiles, file permissions, and overwrite refusal have tests.
Server instrumentation is **not deployed** and the CLI is **not released to npm**.

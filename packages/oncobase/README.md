# `@oncobase/oncobase`

Official Oncobase CLI for syncing, checking, and publishing Obsidian vaults.

```sh
npm install --save-dev @oncobase/oncobase
```

Configure a vault once:

```sh
npx oncobase init --site acme --vault . --publish-url https://wiki.example.com/api/publish
```

Then run the publish workflow from the vault:

```sh
npx oncobase sync --site acme
npx oncobase check --site acme
npx oncobase publish --site acme
```

The publish token can be provided with `WIKI_PUBLISH_TOKEN_<SITE>`, `WIKI_PUBLISH_TOKEN`, or `~/.config/wiki/<site>.token`.

## Commands

- `oncobase init --site <slug> --vault <path> --publish-url <url>` writes local site configuration.
- `oncobase sync --site <slug>` reconciles remote documents/assets into the vault and writes review artifacts for conflicts.
- `oncobase check --site <slug>` runs a dry-run publish and reports changed, unchanged, and stale records.
- `oncobase publish --site <slug>` uploads changed content, assets, embeddings, and confirmed tombstones.
- `oncobase skills --site <slug>` copies bundled vault skills into `<vault>/.claude/skills`.
- `oncobase assets:backfill-hashes --site <slug>` backfills asset hashes without a full content upload.
- `oncobase docs:backfill-hashes --site <slug> --since-ref <commit>` backfills document hashes without a full content upload while protecting recent local edits.
- `oncobase elicit papers <query>` searches Elicit's academic-paper index and emits provenance-preserving JSON or Markdown.
- `oncobase elicit trials <query>` searches ClinicalTrials.gov through Elicit and emits provenance-preserving JSON or Markdown.
- `oncobase transcription record --site <slug> --context <file>` records audio until Ctrl-C, then transcribes and drafts an enriched note with Vercel AI Gateway.
- `oncobase transcription transcribe --site <slug> --audio <file> --context <file>` transcribes an existing recording and drafts the note after the fact.

## Local publish timing

The source CLI saves phase/request timings automatically, including failed runs,
under `~/.config/wiki/publish-profiles/`. `--profile <new-file.json>` or
`PUBLISH_PROFILE=<new-file.json>` overrides the location; `--no-profile` opts out.
Choose a new output filename for each run; profiles refuse to overwrite files.

```sh
oncobase publish --site acme --profile /tmp/publish-001.json
```

The profile records monotonic start offsets, parent span IDs, durations, status,
counts and byte totals for scanning, sync, embeddings, metadata, uploads and
publisher requests. Asset scans separate discovery, document parsing, hashing
and ownership. HTTP requests separate JSON serialization, time to response
headers, response-body download and JSON parsing. Time to headers includes
network/upload, platform queueing and server work; it is **not** pure backend
time. Response bytes measure decoded UTF-8 payload size, not wire/compressed
size. Nested or concurrent durations must not be summed as wall-clock time.

Profiles contain no URLs, slugs, source bodies, tokens or error text, and are
written with mode `0600`. Pending spans remain marked `running` on early exit;
SIGKILL cannot produce an exit profile. The recorded total starts after module
loading, not at shell process creation. Profiling does not change publish scope,
retry policy or success semantics.

Local workaround scripts can use the exported `installPublishProfile`,
`publishProfile` and `publisherPost` helpers instead of uninstrumented `fetch`:

```ts
const profile = installPublishProfile("/tmp/publish-002.json");
await profile.span("verify.documents", async () => {
  // Use publisherPost(url, token, body) for publisher API requests here.
});
```

Profiled requests send W3C `traceparent` and `X-Publish-Profile: 1`. On an updated
server, numeric `Server-Timing` fields show backend/RPC totals and publish
inventory phases without a collector. With `WIKI_BACKEND_TRACING=1`, existing
OpenTelemetry spans use fixed `/api/publish/*` route names and join the local
request's trace ID. Configure the existing OTLP exporter and sampling separately;
the local JSON profile is **not** itself an OTLP export. Unupdated servers still
work, but cannot provide the new backend breakdown.

The repository also includes a **read-only** replay of the temporary publishers'
full-manifest planning and paginated verification path:

```sh
bun apps/app/scripts/profile-local-publish.ts --site acme --vault /path/to/vault \
  --files-from /tmp/document-paths.json --profile /tmp/read-only-profile.json
```

`document-paths.json` is a nonempty JSON array of vault-relative Markdown paths.
This probe scans the vault, makes three dry-run plans, and fetches verification
pages until the selected slugs are found. It never acquires a lock, uploads,
finishes a release, or checks source/remote hash equality. It measures the read
overhead of that workflow, **not** a completed publication.

## Scoped publishing and performance trade-offs

These additions are in source and require the matching backend deployment and
CLI release 0.2.0; npm version 0.1.4 does not provide them. The examples pin 0.2.0
so an older CLI cannot silently ignore scope flags. Until that version is
published, run the source CLI or the locally built package. A scoped publish uses a new
endpoint and fails closed on an old backend instead of sending a partial
manifest to the old whole-vault endpoint.

For routine edits, save reviewed vault-relative paths as a JSON array, for
example `["wiki/home.md", "wiki/care/overview.md"]`, outside the vault. Use the
same scope and policies for the plan and the publish:

```sh
npx @oncobase/oncobase@0.2.0 publish --site acme --files-from /tmp/release.json --assets referenced --dry-run
npx @oncobase/oncobase@0.2.0 publish --site acme --files-from /tmp/release.json --assets referenced
```

The command prints its effective policy. Unknown arguments and conflicting
options are errors. Scoped publishes skip implicit sync, never infer deletions,
and verify all selected documents and asset registrations before finishing.
Use `--vault /path/to/release-worktree` to select a clean release checkout without
rewriting the shared site configuration; an explicit sync uses that same checkout.
Choose `--sync-first` explicitly when remote changes need to be pulled/reconciled
first. A dry-run performs no sync, embeddings, uploads or lock acquisition.

| Choice | Benefit | Cost or limit |
| --- | --- | --- |
| `--assets none` | Skips asset discovery and hashing for known document-only changes | Skips attachment and ownership/visibility changes; use `referenced` when links or sensitivity change |
| `--assets referenced` (scoped default) | Hashes only assets owned by selected documents | Parses other documents to retain shared-owner visibility; asset bytes still require upload bandwidth |
| `--assets all` | Includes the entire asset inventory | Reads/hashes all asset bytes; a bulk operation may exceed 20 seconds |
| `--embeddings auto` (default) | Generates embeddings when the API key exists | Token waits, retries, and inference add latency; missing key is reported |
| `--embeddings skip` | Removes inference from the critical path | Existing search vectors can be stale; this does not schedule a later refresh |
| `--embeddings required` | Fails when the key is missing | Publishing waits for embedding generation |
| `--verify content` (scoped default) | Compares a digest computed from stored raw content and metadata | Large documents without stored raw content cannot pass this check |
| `--verify metadata` | Supports documents without stored raw copies | Trusts the stored source hash instead of independently hashing the content |
| `--doc-concurrency 4` / `--asset-concurrency 3` | Allows tuning load and memory explicitly | More concurrency may trigger database contention or bandwidth saturation; defaults remain 16 and 6 |
| `--request-timeout-ms 20000` | Bounds an individual publisher API request | A timeout is an uncertain write outcome, not a successful publish; requests are not blindly retried |

Scoped uploads use content-based blob paths, recheck local bytes against the plan,
then download and hash the uploaded bytes before registration. Previously unchanged
assets receive registration/size/visibility checks; they are not downloaded again.
An asset without a recorded content hash is uploaded and verified, rather than
having its hash asserted through a metadata-only backfill. Large scoped asset
batches require confirmation regardless of how many documents are selected.
Scoped runs own their lock and declared scope. Stale writes/aborts/finishes are
rejected inside the database transaction. Manifest invalidation is coalesced at
finish (or abort after partial writes), avoiding a shared site write per document.
The CLI then waits up to 15 seconds for a current reader snapshot and checks its
actual bytes, content hashes, public inclusions and sensitive exclusions. This is
not a browser rendering test. A committed-but-unconfirmed run exits with failure
and says that data was committed; it does not report a verified publication.
Whole-vault publishing keeps
its existing sync and verification defaults; use `--verify` to opt into the new
verification there. Failed/skipped assets and incomplete metadata backfills now
fail publication rather than reporting success. Active workers drain before an
error triggers abort.

## Repeatable read-only benchmarks

```sh
bun apps/app/scripts/benchmark-local-publish.ts --site acme \
  --files-from /tmp/release.json --scenario documents --repeat 3 \
  --profile /tmp/bench-trace-001.json --output /tmp/bench-results-001.json
```

Scenarios are `no-op` (unchanged inputs), `documents` (in-memory synthetic edits),
`mixed` (synthetic document edits plus real referenced assets), and `large`
(at least 100 selected documents). The same selection and targeted verification
code serves the publisher and benchmark. HTTP mode only sends a scoped dry-run
plan and targeted state reads; no source content or asset bytes are uploaded.
Baseline mismatch counts expose when the existing remote state differs from the
local inputs. They are not proof that the simulated edits were published.

`--transport fixture --fixture-latency-ms 250` measures real local scans with a
simulated server delaying each HTTP request 250 ms. It does **not** model Convex
RPCs, lock contention, database writes or production latency. Both modes omit
locks, writes, blobs, embeddings, finish, and reader visibility. Reports include
per-iteration scan/plan/verification time, first/median/max time, request count,
decoded bytes and an explicit list of these omissions. `--budget-ms 20000`
returns a failing exit code if any measured sample exceeds the budget. Fixture
success is not evidence that real publishing meets the 5–20 second goal.

Before deploying the new endpoint, the existing indexed-query experiment can
measure selection against a live backend:

```sh
bun apps/app/scripts/profile-indexed-publish-reads.ts --site acme \
  --files-from /tmp/release.json --concurrency 4 --repeat 3 \
  --profile /tmp/indexed-trace-001.json --output /tmp/indexed-results-001.json
```

This needs backend service credentials. Operators can explicitly use `--operator`
with an existing `CONVEX_DEPLOY_KEY` and backend URL to read the equivalent internal
query. Its transport rejects mutation/action requests. It fetches selected reader
content into memory, reports only counts/timing, and compares stored hashes and
visibility. It bypasses the publisher HTTP route and does not measure the new
batched query or independently verify raw content.

## Asset visibility and exclusions

The publisher derives asset ownership from Markdown, Obsidian, and HTML links.
Assets referenced by a sensitive document are stored as sensitive and are not
served by `/api/file` without an authenticated session. Shared assets fail
closed: if any owning document is sensitive, the asset is sensitive.

Git-ignored files are excluded from publish manifests. To retain a tracked
source file in the vault without publishing it, add its vault-relative path to
`.oncobaseignore`. Directory entries end with `/`; `*`, `**`, and `?` are
supported.

```text
# Hold back one attachment and an archival render directory.
sources/emails/images/private-screenshot.png
sources/archive/slides/
```

## Transcription

Transcription uses the Vercel AI Gateway by default with `openai/gpt-realtime-2`. Set `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` before running it. The recording command requires `ffmpeg`.

```sh
npx oncobase transcription record --site acme --context ./call-context.md --title "Partner call"
npx oncobase transcription transcribe --site acme --audio ./meeting.mp3 --context ./call-context.md --wiki wiki/people
```

Useful options:

- `--context <file>` adds explicit context files; repeat it or pass comma-separated paths.
- `--wiki <slug-or-path>` adds specific wiki pages from the configured vault.
- `--wiki-all` includes wiki page bodies until `--max-context-chars` is reached.
- `--model <id>` overrides the default Gateway model.
- `--output`, `--transcript-output`, and `--note-output` choose output files.

## Elicit research search

Set `ELICIT_API_KEY`, or store the key in `~/.config/oncobase/elicit.token`
with permissions `0600`. The API key is sent only in the authorization header
and is not included in saved search artifacts.

JSON is the default and includes the request, retrieval timestamp, endpoint,
results, and API warnings. Use `--format markdown` to create a reviewable Diana
research note. The Markdown output explicitly labels Elicit as a discovery
source whose decision-relevant claims require primary-source verification.

```sh
oncobase elicit papers "TNBC antibody-drug conjugates" \
  --min-year 2022 --type-tag RCT --max-results 25 \
  --format markdown --output sources/research/elicit/tnbc-adc-search.md

oncobase elicit trials "TNBC antibody-drug conjugates" \
  --phase PHASE2,PHASE3 --status RECRUITING \
  --format json --output sources/research/elicit/tnbc-adc-trials.json
```

Run `oncobase elicit --help` for the complete paper and trial filter list.

## Bundled Skills

The CLI ships two default skills:

- [`wiki-quickstart`](skills/wiki-quickstart/SKILL.md) for first-time vault setup and the initial sync/check/publish loop.
- [`check`](skills/check/SKILL.md) for safe pre-publish validation.

After upgrading, `oncobase skills --site <slug>` refreshes these bundled skills.
The installed bundle takes precedence over an older copy already in the vault;
keep custom workflows under separate skill names if they should not be replaced.

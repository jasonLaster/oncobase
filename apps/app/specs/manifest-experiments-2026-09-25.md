# Manifest readiness experiments — September 25, 2026

Small public-page additions can reuse the verified previous manifest instead of reading every document. Adopt that change, plus generation-owned build leases and two durable retries. Keep the full builder's 500-row batch size: larger batches showed little warm-cache benefit and worse first-pass latency.

## Evidence and measurement boundaries

Ran local, read-only shadow experiments against production at revision 1534: 6,751 public pages and 1,086 assets. Backend transport allowed only `/api/query`. Synthetic additions/updates stayed in memory. No document, asset, publish lock, or manifest snapshot was modified by these benchmarks.

Every result matched the independent full builder's manifest hash, with stable production revision/hash before and after each trial. Timings include the initial status query, data retrieval and assembly; exclude the post-trial revision check, independent equivalence oracle, Axiom export, writes, scheduler queue, snapshot upload/install, and reader polling. These are **assembly measurements, not end-to-end publish latencies**. Trials use local Bun; Convex Node runtime costs may differ.

| Strategy | Trials | Median | Range | Timed network requests |
|---|---:|---:|---:|---:|
| Full scan, 500 rows | 3 | 2.505s | 2.373–10.889s | 24 |
| Full scan, 1,000 rows | 3 | 2.435s | 2.267–14.603s | 23 |
| Full scan, 2,000 rows | 3 | 2.329s | 2.207–15.117s | 23 |
| Snapshot + 1 synthetic update | 3 | 0.661s | 0.491–0.797s | 3 |
| Snapshot + 16 synthetic updates | 3 | 0.659s | 0.580–0.704s | 3 |
| Snapshot + 1 synthetic addition | 3 | 0.602s | 0.451–0.804s | 3 |
| Snapshot + 16 synthetic additions | 3 | 0.633s | 0.589–0.781s | 3 |

The first full scans took 10.9–15.1 seconds; subsequent scans took 2.2–2.5 seconds. Order rotated each iteration, but cache warmth was not controlled or flushed. Do not compare these as randomized cold-cache trials or claim a production p95. Changing batch size from 500 to 2,000 saved only one request; this experiment does not prove which database limit caused the short pages.

The original 21-trial matrix also included six existing-page lookups without changing their metadata (0.438–0.741s). A second six-trial run explicitly changed title/hash in memory; the table uses those genuine update simulations. All 27 trials passed.

## What changed

- **Public additions:** up to 128 document-only scoped pages can patch the previous verified public snapshot. New slugs trigger tree reconstruction and deterministic page sorting. Existing-page updates retain the tree. Both paths retain raw wire property order for hash compatibility.
- **Conservative fallbacks:** missing/deleted/private pages, duplicate updates, invalid or wrong-site bases, stale revisions, changed assets, and larger scopes still use the full builder. Asset membership is reused only for a document-only publish scope.
- **Owned leases:** each queued build receives a monotonically increasing generation. Superseded jobs discard their output and cannot release the successor's lease or overwrite its snapshot. Legacy scheduled jobs cannot clear a generation-owned lease.
- **Transient failures:** the owning job schedules at most two durable retries, after 250ms and 1,000ms. Delta scope and trace correlation survive retries. An active publisher retains responsibility for scheduling after its writes finish. Failed orphan cleanup no longer skips retry handling.
- **Observability:** `manifest.attempt` distinguishes initial builds and retries in Axiom. No document content, slugs, storage URLs, credentials, or arbitrary error bodies are exported.

The fast path still parses and hashes the whole cached snapshot: database reads scale with the change, while snapshot transfer and CPU remain proportional to total metadata. This measured trade-off avoids a new metadata table/migration and is small enough for the present vault. It does not deliver a strict O(change-size) publisher.

## Reliability experiments

Fault injection exercised transient failures through retry exhaustion, a late success/failure after lease replacement, expired leases, legacy jobs, active writers, concurrent revisions, and installation failure combined with failed orphan cleanup. An action-level test verified that a public addition uses the delta and carries its generation into installation. Tests also compare full/delta trees for nested additions, hidden paths, file/directory collisions, PDF collisions, empty bases and Convex property ordering.

34 focused backend/publisher/telemetry tests passed (246 assertions); 16 wiki server tests passed (86 assertions). Application typecheck, focused lint and production build passed. Faults were injected locally, not into production dependencies.

## Axiom custody

Dataset: [oncobase-traces](https://app.axiom.co/jlast-ixpg/datasets/oncobase-traces), EU endpoint, 30-day retention. HTTP ingestion accepted all records; dashboard read-back verified the matrix. API querying remains unavailable with the current ingest key (403); the authenticated dashboard is queryable.

- Initial matrix: trace/experiment `3b933625bf14c73f351b6a4584c1dcec` (21 spans).
- Explicit synthetic updates: `da50ecbcab5b29f068682d9ba06ac91e` (6 spans).
- Local fault/regression summary: `186c0de1956cc42fb05572feb0c34208` (1 span, 34 tests, 0 failures).
- Aggregate local evidence: `experiments/manifest-2026-09-25.json`, `manifest-updates-2026-09-25.json`, `manifest-reliability-2026-09-25.json`.

```apl
['oncobase-traces']
| where name startswith 'experiment.manifest'
| summarize samples=count(),
    passed=countif(tostring(['attributes.custom']['experiment.outcome']) == 'passed'),
    fastest=min(duration), slowest=max(duration)
  by variant=tostring(['attributes.custom']['experiment.variant'])
```

## Reproduce locally

From the repository root:

```sh
bun apps/app/scripts/benchmark-manifest.ts \
  --env-file /absolute/path/to/.env.local \
  --backend https://youthful-cricket-560.convex.cloud \
  --site diana --output /tmp/new-manifest-benchmark.json \
  --repeats 3 --batch-sizes 500,1000,2000 \
  --variants full,update-1,update-16,add-1,add-16 \
  --revision REVIEWED_GIT_SHA --export-axiom
```

`--env-file` needs the target deployment's `CONVEX_DEPLOY_KEY`; exporting also needs `AXIOM_API_KEY`, `AXIOM_URL` and `AXIOM_DATASET`. The explicit backend is mandatory, repetitions are bounded (1–5), batch sizes bounded (128–2,000), and output must be a new path. No credentials are printed. Failed or revision-invalidated trials are retained and cause nonzero exit; no performance conclusions should use them as successes.

## Remaining work

1. Measure real small additions after rollout, including queue/storage/install and reader readiness. This benchmark does not prove all publishes meet 5–20 seconds.
2. Full rebuilds still read large document rows. A transactional metadata projection could remove this bottleneck but adds migration, consistency and write-amplification costs. Prototype it against the same hash-equivalence benchmark before adopting.
3. Automatic retries cover handled failures. A process crash before failure handling still needs lease expiry and a later request/write. A fenced watchdog is a separate reliability improvement.
4. Benchmark assets, sensitive pages, deletions, large scopes and concurrent writers beyond the local guards; those paths retain full rebuild behavior.
5. Grant a dedicated query key for unattended Axiom regression reports. Dashboard read-back currently supplies the verification.

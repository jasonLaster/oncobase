# Publishing cache experiments

Adopted two automatic optimizations: reuse parsed documents within one publish
invocation, and reuse the current server snapshot when a scoped run changed no
manifest-visible data. Both are deployed/installed; neither requires new flags.

| Experiment | Before median | After median | Decision |
| --- | ---: | ---: | --- |
| Real-vault mixed scan, seven paired comparisons | 1.194 s | 0.716 s | Adopt shared parsing; 40% lower scan time |
| Hosted full no-op, three runs per matched cohort | 5.109 s | 1.570 s | Adopt unchanged snapshot reuse; 69% lower wall time |
| Hosted 100-document writes, three runs per matched cohort | 10.759 s | 10.046 s | No observed regression in the matched comparison |
| Actual Diana command, production no-op | 13.327 s | 2.260 s | Production confirmation; 83% lower median versus previous day |

Production after samples were **2.413, 2.199 and 2.260 seconds**. They include
startup, local scan, owned lock, fresh stored-content verification, finish and
reader readiness. A transport guard rejected all document/asset writes, refused
a changed plan and required an empty finish. No clinical content was changed.
Reader readiness fell from roughly 10–12 seconds to 0.43–0.51 seconds because
no-op finish retains the existing valid snapshot instead of rebuilding it.

## Experimental controls and limitations

The local scan benchmark alternates shared/separate order and requires identical
serialized documents and assets for every pair. The current vault had 6,889
publishable documents; the mixed scope selected one document and seven assets
(2,297,341 bytes). Each variant hashes selected asset bytes. OS cache state is
uncontrolled, and the first run is not claimed to be a cold-disk measurement.

Hosted writes use the existing isolated synthetic site with 7,011 documents and
11,000 PDF metadata records. The matched control deployed backend commit 62a61b0f;
the candidate deployed 17591b90. Both used the same updated CLI, hosted API,
cloud database, corpus and concurrency. The control included the tombstone index
already used by production. The candidate was restored after control measurements.
All writes were synthetic; embeddings were explicitly skipped in these cohorts.

An initial before/after staging experiment was not matched for the tombstone
index. It produced 100-document totals of 10.6–11.5 seconds before and 10.5–12.9
seconds after. Upload time stayed around three seconds; the difference was in
reader readiness. These results are retained, not discarded. The matched control
and final candidate runs above resolve that confound, although three repetitions
are not sufficient to establish a small throughput improvement or tail latency.
Production's prior-day comparison is not an alternating control.

All samples and top-level phase durations are in
[publish-cache-experiments-2026-09-23.json](publish-cache-experiments-2026-09-23.json).
The pre-cache production baseline remains in
[publish-production-benchmark-2026-09-22.md](publish-production-benchmark-2026-09-22.md).

## Why these two changes have high ROI

Shared parsing removes duplicate file inventory, reads, frontmatter parsing and
hashing. Asset ownership still includes every document, including owners outside
the selected scope. Each new invocation scans fresh files; there is no persistent
cache to become stale. Profiles now expose `parsedDocuments` and `reusedDocuments`.

Snapshot reuse is decided by the backend. The first actual manifest-affecting
mutation transaction marks its run changed; subsequent workers avoid more shared
site writes. Finish, abort, expiry and takeover invalidate changed runs. Missing
tracking state from an older run is conservatively treated as changed. No-op
finish reuses only a matching revision/format with an existing storage blob;
missing/stale snapshots queue repair. Fresh content and reader-byte verification
remain mandatory. The first-write marker can cause transaction retries among
concurrent workers; the 100-document comparison checks this trade-off directly.

## Deferred

- Persistent parsing/reference caches: less remaining headroom after shared
  parsing, plus disk serialization, privacy, versioning and invalidation costs.
- Asset hash caches based only on size/mtime: could conceal changed bytes. All
  selected asset bytes continue to be hashed; upload-time rechecks remain.
- Embedding caches: potentially useful for interrupted retries, but these
  experiments did not establish their hit rate or benefit. No speculative cache
  or weaker verification was added.

## Reproduction and adoption

The local comparison is network-free and writes only a new result file:

```sh
bun apps/app/scripts/benchmark-publish-scan.ts --vault /path/to/vault \
  --files-from /tmp/reviewed-files.json --repeat 7 --output /tmp/new-scan-results.json
```

The existing `benchmark-local-publish.ts` still exercises read-only HTTP planning
and verification. It does not measure snapshot reuse because dry-runs correctly
omit locks and finish. Snapshot reuse was therefore tested with guarded full
no-ops and synthetic full publishes, not relabeled read-only timings.

Diana's actual vault-local dependency is now the reviewed vendored CLI 0.2.1;
frozen installation passed. The global CLI linked to the main workspace was
rebuilt too. Public npm publication remains pending authentication. The backend
is deployed from 17591b90; no frontend redeployment was needed. Changes extend
PR #64 and preserve unrelated workspace/vault edits. CI is unchanged.

Validation: 386 app unit tests and 37 CLI tests passed. Focused tests additionally
cover independent asset/PDF/hash/visibility writes, identical document retries,
no-op abort/expiry, stale or missing snapshots, deleted storage, old-run fallback,
and visibility changes/deletion outside the local scope. Typechecking, CLI build,
targeted lint and diff checks passed. React Doctor still emits advisory warnings
for intentional sequential test/benchmark loops; this is not a warning-free claim.

# Local publishing: production verification

The optimized backend and API are live on Diana. The actual vault command,
`bun run wiki:publish`, completed three full production no-change publishes in
**11.83, 13.33 and 13.46 seconds**. This includes startup, lock acquisition,
content verification, finish, snapshot rebuilding and reader readiness.

These were guarded no-ops: a transport wrapper rejected every document/asset write
endpoint and refused any changed plan or nonempty finish. No clinical content was
changed. Real document edits, fresh embeddings and uploads were exercised on the
[isolated synthetic site](publish-live-benchmark-2026-09-22.md), where all final
scenarios completed in 6–12 seconds. Those timings are not production write timings.

## Read-only production benchmark

Three iterations per scenario; all actual-content and asset-state comparisons
matched. Document and asset changes exist only in memory for planning.

| Scenario | Scope | Median | Maximum |
| --- | --- | ---: | ---: |
| No-op | 16 documents | 0.828 s | 0.964 s |
| Document edits | 16 documents | 0.817 s | 0.885 s |
| Mixed edits | 1 document, 7 assets, 2.30 MB hashed | 1.454 s | 1.618 s |
| Larger edit | 100 documents | 2.080 s | 2.103 s |

These measurements omit locks, writes, uploads, embeddings, finish and reader
readiness. The benchmark rejects write routes and never transmits content bodies
or asset bytes. Results, phase totals and the failed first attempt are in the
[machine-readable report](publish-production-benchmark-2026-09-22.json).

## The additional production bottleneck

The first full no-op correctly failed after 17.95 seconds because reader readiness
was unconfirmed. Its asynchronous snapshot took 20.88 seconds and failed;
20.32 seconds were spent reading. Individual queries repeatedly read about 16 MB
of document bodies while returning almost no visible rows. Deleted documents
were still present in the public sensitivity index.

The new `(siteId, deletedAt, sensitive, slug)` index excludes tombstones before
pagination reaches its byte limit. Two indexed partitions preserve both unset and
legacy zero deletion timestamps. Public requests also exclude private rows before
pagination. Tests cover these cases, tenant isolation and invalid cursors.

Successful production snapshot samples took 8.18 and 9.63 seconds:

| Phase | First sample | Second sample |
| --- | ---: | ---: |
| Database reads | 7.611 s | 7.941 s |
| Tree construction | 0.078 s | 0.291 s |
| Hashing | 0.047 s | 0.242 s |
| Serialization | 0.039 s | 0.100 s |
| Blob storage | 0.301 s | 0.527 s |
| Snapshot installation | 0.026 s | 0.049 s |

The next likely optimization is a small metadata projection for manifest reads,
which currently fetch full active document rows from storage. That trades extra
write maintenance and backfill complexity for lower rebuild latency. It was not
needed to meet the measured 5–20 second target. Avoiding invalidation on an owned
no-op is another option, provided actual writes are tracked transactionally.

## The command people actually run

Diana's vault-local dependency was 0.1.3, shadowing the newer global CLI. It now
uses the reviewed 0.2.0 tarball under `.agents/vendor/`; a frozen install passed.
Its existing check and quickstart skills now use the scoped command below.
The npm registry release still requires authentication; local operation works.

```sh
bun run wiki:publish --site diana --vault "$PWD" \
  --files-from /absolute/path/reviewed-files.json \
  --assets referenced --embeddings auto --verify content --dry-run
```

After reviewing the plan, use the same arguments without `--dry-run`. The JSON
scope is a nonempty array of vault-relative Markdown paths. Automatic private
profiles are written under `~/.config/wiki/publish-profiles/`.

For a repeatable read-only benchmark from the Oncobase checkout:

```sh
bun apps/app/scripts/benchmark-local-publish.ts --site diana \
  --files-from /absolute/path/reviewed-files.json --scenario documents \
  --repeat 3 --budget-ms 20000 \
  --profile /tmp/new-publish-profile.json --output /tmp/new-publish-result.json
```

Choose `no-op`, `documents`, `mixed` or `large`; mixed requires a referenced asset,
and large requires at least 100 documents. Output files must be new.

Skipping embeddings leaves stale search vectors. Skipping assets omits ownership
and visibility updates. Metadata verification is weaker than content verification.
Large uploads and provider throttling prevent a universal 20-second guarantee.
CI configuration was unchanged.

Production API deployment: `dpl_33bsVTd7LydAFssJ23i7XBVTLjWC`, source `cfff7183`.
Production backend includes the subsequent tombstone-index fix, `7459003d`.
The release work is on `codex/publish-performance`; it has not been merged to main.

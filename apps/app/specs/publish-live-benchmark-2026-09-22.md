# Local publisher: real cloud benchmark

The optimized local CLI completed every repeated final scenario within 12 seconds on an isolated hosted API and cloud database. The fixture contained 7,011 documents and 11,000 PDF metadata rows. Production remains unreleased; these are synthetic staging results, not timings from Diana production.

| Scenario | Three complete runs |
| --- | --- |
| noop-16 | 6.24 s, 8.03 s, 7.67 s |
| edit-16 | 7.48 s, 6.98 s, 6.75 s |
| mixed-16 | 8.78 s, 7.80 s, 8.40 s |
| edit-100 | 10.72 s, 10.68 s, 11.46 s |
| embedding-16 | 7.62 s, 6.99 s, 7.36 s |

Times include process startup, scope parsing, lock acquisition, actual writes, content verification, finish, snapshot rebuilding and reader readiness. Embeddings were explicitly skipped except in the `embedding-16` case, which required fresh embeddings. The mixed case uploaded and downloaded a new 1 MB SVG each time. The PDF scale rows model catalog size; they have placeholder blob URLs and are not selected for publication.

## What the spans and logs found

- The historical full-feed verification took 34–37 seconds and downloaded 116 MB to check 16 documents. Indexed selection removes that full-site transfer.
- The shared Convex HTTP client queued mutations even with concurrent CLI workers. Scoped writes now bypass that client queue while transactional ownership and scope guards remain enforced. On the same small cloud fixture, 100-document publishes fell from 19.79–22.82 seconds to 6.93–7.89 seconds.
- At larger scale, snapshot database reads finished in 2.91 seconds, but the complete build took 26.72 seconds. Repeated sibling scans made tree construction quadratic for wide folders. Per-folder maps reduced final observed builds to 2.51–4.69 seconds. Structured `publish.manifest` logs now break out reads, filtering, tree construction, hashing, serialization, storage and installation.
- A real mixed publish caught a bad readiness assumption: public manifests list PDFs only, with null hashes. Readiness now checks PDF membership and uses the reader’s indexed asset-access queries for hashes and public/sensitive visibility. A committed-but-unverified publish exits with failure.

## Read-only benchmarks

Each scenario ran three times against the hosted API with the larger corpus. All baseline content and asset comparisons matched; no locks, writes, uploads, embeddings or finish calls were made.

| Scenario | Median | Maximum |
| --- | ---: | ---: |
| no-op | 0.500 s | 0.614 s |
| documents | 0.486 s | 0.530 s |
| mixed | 0.555 s | 0.579 s |
| large | 2.080 s | 2.906 s |

The mixed read-only scenario changes both document and asset hashes in memory to exercise upload planning; it never sends source content or asset bytes. The larger scenario selects 100 documents. Full samples and phase totals are in [the JSON report](publish-live-benchmark-2026-09-22.json).

## Robustness and adoption

Deployed checks returned HTTP 409 for stale abort, legacy abort against an owned lock, stale finish, out-of-scope document write, and a write arriving after its run had ended. The owning abort succeeded. A browser rendered the latest selected document and decoded the real uploaded image with no page errors; this is a smoke check, not exhaustive reader coverage.

The last ten local attempts used temporary API scripts rather than the released CLI. Version-pinned examples, refreshed bundled instructions, printed effective policies and strict argument parsing address adoption. Unknown flags fail before publishing. The candidate supports explicit scope, vault, asset, embedding, verification, concurrency and timeout choices.

Trade-offs remain visible: `--embeddings skip` leaves old search vectors; `--assets none` omits asset ownership updates; metadata-only verification is weaker than the default content check. Bulk byte transfers and provider throttling cannot be guaranteed under 20 seconds. A failed deadline is never counted as a successful publish.

## Release state

The source candidate and benchmark are validated on isolated infrastructure. CLI 0.2.0 is not on npm, and the production backend/API have not been activated. CI configuration is unchanged. Release and production verification remain part of the active goal.

Validation: 385 app unit tests, 36 CLI unit tests from the earlier candidate, and all 76 shared-content tests pass (suites overlap). App typechecking, targeted lint and diff checks pass. React Doctor advisory findings concern intentional sequential benchmark/batch loops and independent state-read groups; its warning threshold was not treated as a clean pass.

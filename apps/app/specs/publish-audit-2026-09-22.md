# Publish performance and reliability audit — September 22, 2026

Historical findings at the dated cutoff below. Later changes and measurements are documented in [the September 27 targeted publishing report](targeted-publish-2026-09-27.md).

The priority is to make a normal publish small and truthful. More concurrency and more optional flags alone will not get us to reliable completion in under 30 seconds.

Reviewed the latest ten completed **Publish wiki** GitHub Actions runs for `jasonLaster/diana-tnbc`, their complete logs, the latest ten local publish attempts in available Codex history, the current CLI/server implementation, the consuming workflow, and an earlier unpublished redesign. Ran read-only local and production benchmarks. No production data or runtime code was changed. Sanitized observations are in [the companion JSON](publish-audit-2026-09-22.json).

**Eight of ten CI runs failed. Both green runs failed every attempted asset upload and nevertheless reported success. None demonstrates complete publication of its intended plan.** Publish steps took 6–63 seconds, median 30.5 seconds; four finished below 30 seconds, all by failing. Complete workflow durations were 79–126 seconds, including checkout/setup/queue overhead. These are separate metrics.

## Last ten automatic publishes

Times below measure the Publish step using GitHub's second-resolution timestamps. Dates are UTC; rows are newest first.

| Run | Started | Publish step | Observed outcome |
| --- | --- | ---: | --- |
| [35756428028](https://github.com/jasonLaster/diana-tnbc/actions/runs/35756428028) | Sep 22 16:47 | 30s | Guard rejected 12,227 assets for zero changed documents |
| [35668794671](https://github.com/jasonLaster/diana-tnbc/actions/runs/35668794671) | Sep 21 23:42 | 55s | Document mutation exhausted concurrency retries |
| [35255327729](https://github.com/jasonLaster/diana-tnbc/actions/runs/35255327729) | Sep 17 17:52 | 23s | Guard rejected 12,227 assets for eight documents |
| [35254932421](https://github.com/jasonLaster/diana-tnbc/actions/runs/35254932421) | Sep 17 17:48 | 25s | Guard rejected 12,224 assets for eight documents |
| [35250952252](https://github.com/jasonLaster/diana-tnbc/actions/runs/35250952252) | Sep 17 17:09 | 26s | Guard rejected 12,214 assets for eight documents |
| [35249277835](https://github.com/jasonLaster/diana-tnbc/actions/runs/35249277835) | Sep 17 16:52 | 43s | Guard rejected 12,199 assets for two documents |
| [35244480587](https://github.com/jasonLaster/diana-tnbc/actions/runs/35244480587) | Sep 17 16:06 | 63s | Green: 27 documents, **12,199 asset failures**, zero asset uploads |
| [35166542798](https://github.com/jasonLaster/diana-tnbc/actions/runs/35166542798) | Sep 17 00:26 | 6s | `/begin` returned opaque HTTP 500; lock contention is plausible, not proven by this log |
| [35166455113](https://github.com/jasonLaster/diana-tnbc/actions/runs/35166455113) | Sep 17 00:24 | 35s | Green: 23 documents, **12,226 asset failures**, zero asset uploads |
| [35165493387](https://github.com/jasonLaster/diana-tnbc/actions/runs/35165493387) | Sep 17 00:11 | 31s | Document mutation exhausted concurrency retries |

Every asset failure in the two green runs reported missing Blob credentials. The workflow passes the publisher token and OpenAI key, but no Blob credential. Supplying that credential alone would enable thousands of unintended uploads, so scope and credential preflight must land together.

The large-upload guard only applies when at most ten documents change. Eleven or more documents disable the guard's protection. This explains why the 23- and 27-document runs attempted the same asset backlog that stopped smaller releases. Replace this heuristic with independent asset-count/byte budgets and an explicit reviewed plan; document count must not authorize asset uploads.

## Local workarounds also miss the target

All ten latest locally recorded invocations executed temporary TypeScript publishers, not the packaged publish command. Scope, checkout, verification, and zero-deletion decisions were embedded in those scripts. This is evidence of a missing usable CLI path, not evidence that users forgot supported scope flags.

| Invocation, newest first (UTC) | Observed duration bounds | Outcome |
| --- | ---: | --- |
| Sep 22 16:47, `healthier-publish.ts publish` | 85.5–96.7s | 16 documents verified |
| Sep 21 23:46, `pt-publish.ts publish` | 54.0–73.8s | **No changes**; seven intended documents verified |
| Sep 17 00:30, PDF publisher | 188.7–216.7s | 115 assets uploaded and byte-verified |
| Sep 17 00:28, budget repair | 122.4–150.4s | Two documents and one asset verified |
| Sep 17 00:27:54, PDF publisher | 54.9–86.2s | `/begin` returned 500 |
| Sep 17 00:27:04, PDF publisher | Exit observed by 34.2s | Terminated, exit 143 |
| Sep 17 00:26, budget repair | 52.1–84.9s | Asset byte verification failed |
| Sep 17 00:25, PDF publisher | Exit observed by 56.9s | Unexpected scoped change rejected |
| Sep 17 00:10, budget publisher | 87.4–221.1s | Post-publish verification found intended changes remaining |
| Sep 16 16:36, meeting publisher | 106.7–125.6s | 18 documents verified |

These are polling intervals, not exact process timings: the lower bound is the last observed running response and the upper bound is the first observed exit. Where there was no intervening running observation, only an upper bound is available. Attempts, retries, no-ops, and failed verifications are deliberately retained. Session/call identifiers are in the JSON; this is not a complete server-side release ledger.

The newest script performs a full local scan, full `/begin` dry-run, full `/begin` acquisition, serial document POSTs, paginated full-content verification, and a third full `/begin` dry-run. The no-op case still performs costly remote inventory/verification. Several local runs overlap CI runs for the same site; GitHub's concurrency group does not serialize these local writers.

## Measured bottlenecks

One read-only sample on this machine, using the current primary vault:

- Read/parse 6,889 documents: **1.181s**.
- Read 13,310 assets, including document reparse, ownership derivation, and hashing **5.29 GB**: **6.486s**.
- Full production `/begin` dry-run, using the latest release's saved manifest: **5.712s**, 3.26 MB request, 70.8 KB response, 7,067 documents and 13,502 assets.
- First 500-document `/sync/documents` verification page: **1.425s**, **6.82 MB response**.

The local checkout and saved release manifest differ; their counts should not be conflated. These are single samples, not p95 measurements. Local scan timing excludes CLI startup, Git cleanliness checks, and sync preflight. The live requests were read-only and returned HTTP 200.

The source explains the repeated work:

- `packages/oncobase/src/publish.ts`: unconditional full document/asset scan; default sync preflight; embeddings before document upload; no request deadline; failed asset uploads are collected and then `/finish` still runs.
- `packages/oncobase/src/walk-vault.ts`: `readVaultAssets` reparses documents and reads every asset's bytes to hash it before selection is possible.
- `apps/app/server/publish-api.ts`: `/begin` scans document hashes in pages of 100, then assets; scope is absent. `/sync/documents` returns content for whole pages even when verification needs only a few hashes/visibility fields.
- `apps/app/convex/documents.ts` and `lib/manifestRevision.ts`: each changed document calls `invalidateManifest`, which writes the same site record. The CLI's 16 document workers compete over that record. CI logs directly identify the `sites` record as the contention point.

Increasing concurrency now could make reliability and elapsed time worse. A short-term diagnostic mitigation is `PUBLISH_DOC_CONCURRENCY=2` or `4`, followed by measurement. The durable fix is byte-bounded document batches that invalidate the manifest once per batch in the same transaction. Keep invalidation transactionally correct; postponing it until `/finish` while exposing intermediate writes would create stale-reader behavior.

## Arguments: actual omissions, adoption failures, and defaults

All ten CI runs used exactly:

```sh
oncobase publish --site diana --no-sync-preflight --confirm-tombstone
```

| Finding | Evidence | Implication |
| --- | --- | --- |
| Sync skip is already used | `--no-sync-preflight` in 10/10 CI commands | It cannot explain away CI latency; retain targeted conflict detection when redesigning sync |
| No first-class scope | Current CLI has no `--document`, `--files-from`, `--changed-since`, or asset-selection option | Local users wrote scripts; don't blame them for omitting unavailable flags |
| Existing concurrency override unused | No `PUBLISH_DOC_CONCURRENCY` in the workflow; two contention failures | Make a safe batch/concurrency policy the default; expose an override for diagnosis |
| Force dispatch omits its companion flag | Workflow adds `--force`, never `--confirm-full-republish` | Latent broken workflow path; none of these ten runs invoked force |
| Tombstone confirmation is automatic | Added on every non-dry CI run | Confirmation does not express reviewed deletion intent; default to no deletions and require exact delete scope |
| Installed version lags | CI logs and vault lock/dependency resolve `0.1.3`; global local CLI/source are `0.1.4` | Release improvements and update the consumer pin/lockfile; editing source alone has zero CI benefit |
| Prior expressive CLI never shipped | August 27 redesign remains dirty in worktree `a240`; absent from current main | Reuse reviewed pieces, adapt to current app layout, and complete adoption/release verification |
| Guidance repeats expensive work | README recommends sync, check, then publish, whose default sync repeats work | Document one normal command; plan/apply should reuse a revision-bound plan |
| Unknown flags are ignored | Current parser reads named flags without rejecting others | A copied future `--assets none` could silently publish broadly; reject unknown/missing/conflicting arguments before any network or local mutation |

The asset guard's suggested `--confirm-large-asset-upload` was intentionally **not** supplied. That omission protected small releases; automatically adding it would be the wrong fix. Checkout logs also warn about 678 files that should have been LFS pointers. The workflow does not enable LFS checkout. Investigate and hydrate only selected asset bytes; this audit does not attribute all 11,885 hash mismatches to LFS without byte-level comparison.

## Proposed command contract

The following syntax is a proposal, **not supported by the released CLI**. Prefer semantic modes and a durable site profile over a long required incantation.

```sh
# Normal command, configured once for this site's release workflow.
oncobase publish --site diana

# Exact reviewed scope, reusable by CI and agents.
oncobase publish --site diana --vault . --files-from release-files.json

# One document; newly referenced assets are included by default.
oncobase publish --site diana --document wiki/example --assets referenced

# Explicit known baseline, not implicitly HEAD~1.
oncobase publish --site diana --changed-since <verified-release-sha>

# Optional review boundary, without repeating discovery during apply.
oncobase publish --site diana --plan-out release-plan.json
oncobase publish --site diana --apply release-plan.json

# Resume acknowledged work after failure; inspect without replaying writes.
oncobase publish --site diana --resume <run-id>
oncobase publish status --site diana --run <run-id>
```

Proposed defaults for a Git-backed site:

| Setting | Default | Trade-off and behavior |
| --- | --- | --- |
| `--scope auto\|all` | `auto` | Select changes since the **last verified release**, plus referenced dependencies. Requires a server receipt/checkpoint; never substitute the last attempted CI run or `HEAD~1`. Missing/diverged baseline requires explicit initial scope. |
| `--assets referenced\|changed\|none\|all` | Referenced closure of selected docs plus explicitly changed asset paths | Avoids unrelated backlog. Ownership/visibility must account for all owners, including outside scope; use a dependency index or conservative fallback. `none` must reject selected pages needing missing/changed assets or visibility updates. |
| `--sync check\|pull\|none` | `check` | Compare selected remote revisions and reject conflicts without downloading/writing the entire vault. `pull` is explicit reconciliation; `none` needs explicit overwrite semantics, not silent conflict loss. |
| `--embeddings background\|inline\|off` | `background` | Core content/keyword search can complete first; semantic search lags. Requires a durable retryable queue keyed by content hash. Never call omitted embeddings "queued" without actually recording a job. |
| `--verify changed\|full` | `changed` | Always verify selected content digests, asset digest/size, and visibility. Full byte reread across the site belongs in an audit. Changed verification is mandatory for success. |
| `--delete-file <path>` / `--delete-document <slug>` | None | Exact reviewed deletion set; a missing local file is not deletion authorization. Full stale cleanup remains a separate explicit maintenance action. |
| `--timeout 25s` | 25s work deadline plus bounded cleanup inside 30s | Cancels requests and drains workers; returns nonzero/incomplete with a receipt if unfinished. A fast timeout does not satisfy successful-publication latency. |
| `--wait-lock 0s` | Fail immediately with 409, owner/run ID and retry guidance | Avoids spending the budget waiting. Durable CI coordination may queue before the timed command; queue time must be reported separately. |
| `--concurrency <n>` | Conservative until batching removes contention | Human override replaces hidden environment tuning; enforce bounds and print effective value. |
| `--timings`, `--json`, `--receipt <path>` | Timings and receipt always produced | Include effective scope/settings, versions, phase timings, attempts, bytes, commit and verified state. Never persist credentials or full source content. |

`--files-from` should accept a validated JSON array of vault-relative paths, supporting spaces without shell expansion. `--document` and `--asset` should be repeatable. Reject empty/missing scopes, unknown paths, traversal, typoed flags, `--assets none` combined with explicit assets, changed input after plan creation, and an apply plan for a different site/checkout. Print the effective vault and SHA before doing work.

For unconfigured sites, do not infer that a Git delta is a complete initial publication. Initial/full migration must be explicit. Broad repairs need their own reviewed budgets and workflow, not a permissive default profile.

## Robustness changes needed alongside speed

1. **Make success mean verified completion.** Preflight required credentials, hydrated selected assets, size limits, and valid scope before acquiring a lock or writing documents. Any required failed/skipped item means incomplete/nonzero. `/finish` must compare expected operations with acknowledged writes and verification; don't trust a client success message. Preserve partial-progress receipts because existing writes are not atomic.
2. **Scope planning on the server.** Add indexed lookups for selected document/asset keys; absent manifest entries must be untouched. Current full-manifest workarounds avoid accidental tombstones but retain the full-site cost. Version the protocol so old clients cannot silently invoke destructive semantics.
3. **Own locks by run ID.** Current `/begin` acquires a site lock before lengthy planning and only later returns a random run ID; mutations do not associate that ID with ownership. `/abort` and `/finish` operate on the site alone. A failed begin can strand a lock, and an old abort can release a newer run. Bind acquire/write/finish/abort to a run, use expiring leases and fencing, return structured 409 conflicts, and make retries idempotent. Handle the lost-begin-response case with a client-generated idempotency key/status lookup.
4. **Stop workers before aborting.** `Promise.all` rejects on the first failed document worker while other workers can keep writing. Cancel scheduling, drain/abort in-flight work, then release only the owned run. Retry only transient/idempotent operations within the shared deadline; don't blindly retry non-idempotent begin/finish.
5. **Batch without removing visibility guarantees.** Byte-bound batches, invalidate once within each batch transaction, and acknowledge per-item hashes. Begin with small serial batches while the shared site revision remains a contention point. Full atomic multi-batch releases require staged records plus a final revision switch and are a larger migration.
6. **Verify selected records directly.** A publisher-authenticated batch verification endpoint should return source/stored digests, sensitivity, includes, asset size, owner set and visibility. Recompute digests from received bytes. Do not verify a stored caller-supplied hash as proof of byte integrity. Preserve source versus redacted-content hashes separately.
7. **Fix asset metadata handling.** Current server `/asset` accepts/stores path, URL, size and content hash but drops the CLI's owner/sensitivity/include/visibility fields; `/begin` does not compare visibility hashes. Fix this before claiming visibility verification or optimizing away backfills. Immutable content-addressed blob keys also avoid stale-byte reads after overwriting the same URL; this is a design recommendation, not a proven explanation for the observed byte-verification failure.
8. **Coordinate CI and local releases.** A shared server plan/revision and run identity must arbitrate both. Check that the source commit is still acceptable before apply. A partial scoped publish must not advance a global Git checkpoint past other unpublished changes; track coverage or require complete delta coverage before advancing it.

## Under-30-second acceptance target

For routine no-op, document-only, and modest mixed releases, aim at a **28-second design budget**, reserving two seconds for variance: discovery/validation 3s, scoped plan 3s, changed uploads 12s, commit/verification 5s, cleanup/variance 5s. These are proposed budgets, not achieved benchmarks. Target no-ops below 5s. Report end-to-end command time, not just the final POST, and keep verification inside the clock.

Arbitrary multi-gigabyte uploads, cold CI setup, network outages, and a full vault re-embedding cannot honestly be guaranteed to complete within 30 seconds. Choose explicitly: pre-stage verified bulk assets, allow a longer maintenance budget, or return a durable queued run within 30 seconds. **Queued is not published.** If every command must return within 30 seconds, large work must be asynchronous and its completion latency must remain separately visible; this does not meet a literal all-publications-complete-within-30s goal.

Suggested delivery order:

1. Fail closed on incomplete uploads; add credential preflight, strict argument parsing, independent asset budgets, phase timings and receipts. Fix the force-dispatch argument mismatch. Preserve safe guard behavior until scope exists.
2. Deliver server scope/indexed verification, bounded document batches, and run-owned locks; adapt useful pieces of the unpublished `a240` implementation rather than transplanting the old app layout. Do not accept proposed CLI flags before the matching server capability exists.
3. Release a new CLI, update Diana's pinned dependency and lockfile, configure normal defaults, replace temporary scripts, and update README/bundled and consuming skills together. CI must print the installed version and effective settings. Snapshot-test the actual workflow invocation against the CLI parser.
4. Validate small releases using the same content sizes and shapes as these ten runs, not by replaying historical commits over production. Exercise no-op, document delta, referenced asset, visibility-only change, missing credentials, LFS pointer, contention, stale plan, failed begin, partial upload, interrupted/resumed run and stale-cache verification. Track p50/p95, true success, and total time to verified completion including retries. Require ten consecutive representative verified publishes below 30s before claiming this target is achieved.

This audit produces evidence and a proposed implementation contract. It does not claim the latency target is already met, and no release/deployment was performed.

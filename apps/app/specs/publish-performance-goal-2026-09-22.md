# Local publish performance goal

Goal is active: full phase timing, repeatable read-only scenarios, then measured
5–20 second routine publishes. Production completion has **not** been demonstrated
by these changes. CI is outside this investigation and its configuration is unchanged.

## What the measurements establish

The prior local full-feed replay took 54.96–65.61 seconds without any writes.
Checking 16 selected documents required 30 sequential page requests, scanning
7,011 documents and receiving 116.27 MB of decoded JSON. Verification alone cost
34.25–36.77 seconds. Scanning all asset bytes cost another 5.13–5.87 seconds.
See [the baseline breakdown](local-publish-timing-2026-09-22.md).

A new **live, read-only** probe using existing indexed backend queries fetched
the same 16 selected records with four concurrent readers in 842, 453, and 471 ms.
Each iteration returned 597,643 bytes, roughly 195 times less data. This bypasses
the publish HTTP route, uses one existing query per document, and only compares
stored hash/visibility metadata. It does not measure the new batch query or raw
content verification. Only 7/16 records match the older local snapshot, so this
scope must not be used as an unreviewed current release.

The repeatable new benchmark ran three iterations per scenario against the real
local release worktree and a fixture server with 250 ms per HTTP request:

| Scenario | Selection | First | Median | Max |
| --- | --- | ---: | ---: | ---: |
| No-op | 16 documents | 1.09 s | 1.13 s | 1.16 s |
| Document edits | 16 documents, synthetic changes in memory | 1.78 s | 1.03 s | 1.78 s |
| Mixed | 17 documents + one 1,006,752-byte referenced asset | 2.17 s | 2.06 s | 2.17 s |
| Larger edit | 100 documents, synthetic changes in memory | 2.62 s | 2.58 s | 2.62 s |

These are **fixture-backed read timings**, not real publish timings. They include
local parsing/hashing and simulated HTTP delay; they omit backend RPC cost,
locks, writes, blob uploads, embeddings, finish and reader visibility. The first
iteration is not guaranteed to have a cold filesystem cache. Budget enforcement
checks every sample rather than reporting only the best one. Machine-readable
counts and all samples are in [the benchmark report](publish-benchmark-2026-09-22.json).

## Implemented in source

- Automatic private local profiles; fixed phase names and numeric metrics; request
  serialization/headers/body/parse, asset inventory/ownership/hash, embedding
  tokenization, token waits, retry cooldowns and attempts. Backend OTel spans adopt
  the local trace ID; numeric Server-Timing works without an OTel collector.
  The local profile itself is JSON, not an OTLP export.
- Bounded, indexed `publisherState` query and authenticated `/state` endpoint.
  Raw-content digests are computed in the backend and bodies are not returned.
  Missing raw copies are explicit rather than falsely reported as verified.
- `/scoped/begin` plans only requested rows and never infers deletions. Its separate
  endpoint prevents an older backend from interpreting a subset as a full vault.
- `--files-from`, `--assets none|referenced|all`, explicit embedding/verification
  policies, concurrency and per-request timeout arguments. Effective policies
  are printed; unknown flags are rejected. Routine examples and bundled operator
  instructions carry the same scope/policy from planning to publishing.
- Referenced-asset selection before reading/hashing bytes, while deriving shared
  ownership and sensitivity from the entire vault.
- Truly read-only dry-runs, asset visibility metadata preserved by the API,
  failures for skipped uploads/missing backfills, and worker draining before abort.
- Scoped runs own their locks and declared document/asset scope. Database
  transactions reject stale or out-of-scope writes, aborts and finishes. Document
  and asset workers avoid shared manifest writes; finish/abort invalidate once.
- Source hashes are checked before writes; verification checks stored raw and
  redacted content. Dropping an oversized raw copy clears the previous raw bytes.
- Scoped uploads use content-based paths and verify downloaded bytes before
  registering the asset. After finish, the CLI verifies current reader snapshot
  bytes and public/sensitive membership before reporting success.

The last ten local attempts used temporary API scripts rather than the released
CLI. This is an adoption problem as well as a missing-flags problem. Defaults,
visible policies, updated examples and exported selection/state helpers matter
more than adding flags that those scripts never consume. No installed CLI or
existing temporary publisher has been upgraded by these source edits.

Validation: 384 app unit tests and 36 CLI unit tests passed in the isolated
release checkout, including the 51 focused publishing/tracing tests. CLI/app typechecks, package build, packaged Node CLI help
and `git diff --check` passed. Scoped lint and a production Convex deployment
dry-run passed; no backend deployment was activated. The app typecheck covers
the imported Convex code; the Convex standalone typecheck was disabled because
this repository has no `convex/tsconfig.json`. Tests cover read-only dry-run behavior, no inferred
tombstones, rejected invalid scope/credentials, tenant boundaries, actual-content
corruption, missing/incomplete verification rows, ownership outside the selection,
and asset-upload failure refusing success. No production content was written.

## Acceptance checks still outstanding

1. Release the matching backend and CLI 0.2.0 from the isolated
   `codex/publish-performance` checkout, preserving unrelated reader work.
   These edits are currently local and unreleased. Scoped command examples are
   version-pinned and bundled skill refreshes now prefer the installed bundle.
   `--vault` supports clean release worktrees without changing saved site config.
2. Run the new HTTP read-only benchmark against that deployed endpoint with
   current authoritative scopes. Include no-op, one/16-document edits, shared
   attachments, and 100-document batches; keep raw-content verification enabled.
3. Measure real end-to-end writes on a controlled release, including startup,
   lock, embeddings policy, writes, finish and reader visibility. Require repeated
   samples within 20 seconds for routine edits, with 30 seconds the regression
   ceiling. A failed timeout is not a successful publish.
4. Measure database contention before changing worker defaults or batching writes.
   The new scoped path coalesces manifest invalidation at finish/abort; real
   timing must establish whether this removes contention. Read-only runs cannot.
5. Exercise the new ownership, asset read-back and reader snapshot checks on the
   deployed path, including timeouts and delayed manifests. A timed-out request
   still has an uncertain outcome; a lost begin/abort can leave its own lease held.
   Unchanged assets are not downloaded again. Browser rendering is still a
   separate end-to-end check.

Trade-offs must remain explicit: skipping embeddings leaves stale search vectors;
metadata verification trusts the recorded content hash; skipping assets also
skips ownership/visibility updates; explicit sync adds reconciliation cost. Bulk
uploads cannot be promised under 20 seconds independent of byte volume, bandwidth
and provider rate limits. Report those constraints rather than relabeling queued
or incomplete work as finished.

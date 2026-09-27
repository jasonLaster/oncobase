# Targeted publication and reader manifests — 2026-09-27

The updated Axiom token can query `oncobase-traces`. This review uses local publisher profiles, production application traces, read-only production shadow experiments and a guarded live no-op. CI is excluded.

## Evidence and bottlenecks

The initial two-day Axiom window contained 81,251 spans. A subsequent manifest-specific query found 6,589 snapshot-backed responses: none exceeded three seconds; the slowest was 1.058 s. The 1,187 responses without the snapshot-hit attribute contained all 48 requests above three seconds and all 31 above fifteen seconds, with a maximum of 20.980 s. Code and slow request trajectories identify signed-in full-manifest reads as a major source: session scope previously never consulted the public snapshot.

For trace `ce33f6f522ddde97916ae4fb85efce6c`, metadata reading took 20.788 s, including 17 document-page calls; one alone took 12.828 s. Tree/hash/serialization were milliseconds. The timeout fell back to a bounded, incomplete manifest. The latest earlier local publish profile took 17.742 s, of which 13.712 s was reader readiness. Those local profiles predate the current two-day trace window; there were no new publish request spans in that window. Consequently these data do not establish a new content-publish p95.

A second bottleneck was strategy selection: finish chose the incremental path from **selected** scope size and whether any assets were selected. One actual edit among 1,000 selected pages, or a referenced but unchanged asset, forced the full manifest builder.

## Changes adopted

1. Session manifests reuse a hash-verified public snapshot and read authorized private metadata and asset permissions live. A second revision check rejects a changed snapshot; old backends, corrupt data, incomplete metadata and active writers retain a safe full-read fallback. Private output remains privately cached and is never stored in the shared public snapshot. Permissions are checked per request, including revocation and tenant boundaries.
2. Owned publication mutations record a compact, transactionally consistent change journal. Finish reads at most 129 document keys plus an asset marker. Up to 128 actually changed public pages use the existing incremental builder regardless of selection size or unchanged assets. Asset changes, visibility transitions, private pages, stale/corrupt snapshots and larger changes fall back to a full build. Client-reported omissions cannot suppress journal entries. Cleanup is bounded and uses the existing expiry job; it cannot erase an active owner's entries.
3. `--changed-since <git-ref>` selects committed Markdown additions/edits from a clean release checkout. It refuses deletions, renames and non-Markdown changes instead of silently omitting them. The explicit `--files-from` workflow remains available for more complex changes. The default cache remains content-validated; faster metadata caching is still opt-in.
4. Traces now carry manifest scope, effective strategy, fallback reason, incremental candidate count and builder strategy reason. The Axiom query helper has a configurable 1–60 second timeout; expensive cold-column queries no longer fail at the old 15-second timeout without guidance.

The first session experiment was rejected: private pagination hit Convex's 16 MiB transaction read limit even though it returned only metadata. Stored document bodies still count toward that limit, and permission reads need headroom. Both combined private query paths now cap pagination reads at 4 MiB. The rejected trial is retained alongside the corrected result. This production-only failure was not represented by the small unit fixtures; the live shadow experiment caught it before the frontend rollout.

## Measurements

Three rotated repetitions per variant, real production data, 6,751 public pages and 1,086 public PDF assets. Session comparison used an existing account with the most roles, yielding 7,154 allowed pages and 1,110 assets. No private identities, slugs, contents, URLs or credentials are exported. All 15 corrected trials passed hash equivalence and revision stability.

| Read/assembly strategy | Median | Range | Requests counted per sample |
| --- | ---: | ---: | ---: |
| full-500 | 2.802 s | 2.556–11.864 s | 24 |
| update-1 | 0.686 s | 0.603–0.938 s | 3 |
| update-16 | 0.628 s | 0.619–0.750 s | 3 |
| session-full | 3.173 s | 3.003–3.315 s | 31 |
| session-overlay | 1.523 s | 1.299–2.979 s | 18 |

The one-page median is approximately 76% lower than a full rebuild; session overlay is approximately 52% lower than the full session path. The first full rebuild took 11.864 s, so cold performance remains materially worse than warm performance. Counts include the opening status query and exclude the final stability check. These are read/assembly measurements; they omit backend writes, scheduled queue delay, snapshot storage/install, upload bandwidth and embeddings. Session measurements run the shared server function from the operator machine, not through a production Vercel request.

Local read-only publishers used the actual vault and live planning/state APIs with content-validated caching:

| Selected documents | Median | Maximum | Baseline mismatches |
| --- | ---: | ---: | ---: |
| 1 | 0.673 s | 0.690 s | 0 |
| 16 | 0.462 s | 0.669 s | 0 |
| 100 | 1.905 s | 2.810 s | 2 |

The 100-page sample detects two existing local/remote mismatches; its latency is useful, but it is not a verified publish. No content was changed by these experiments. They exercise discovery, planning and verification, not commit or reader readiness. Small-sample timing variation explains why 16 pages appear faster than one; do not infer inverse scaling.

A separate transport-guarded live no-op with the new CLI completed in 1.023 s, including lock/plan, full content verification, finish and snapshot readiness. The guard rejected content/asset writes, unexpected origins and a changed plan. This verifies orchestration and no-op compatibility, not changed-content write latency.

## Trade-offs and remaining limits

- The journal adds one small indexed record per changed document, plus conservative asset markers and bounded cleanup. It avoids repeatedly patching a shared growing list. A deployment-spanning legacy run uses its conservative scope fallback.
- The snapshot overlay downloads and hashes roughly 3.7 MB of public metadata. It is not O(changed documents) on the wire. Small publication assembly also still serializes/stores the complete manifest. Subsecond changed-content publication would require further changes to manifest transport/storage and scheduled execution.
- Private/visibility/asset-heavy publishes and changes above 128 pages still rebuild. The 5–20 second end-to-end target is not established for those cases or for fresh content publishes in production. No synthetic medical content was published to manufacture timing evidence.
- Full content verification still scales with selected scope. Use a narrow explicit scope or `--changed-since` to avoid checking hundreds of unchanged pages. Embeddings and uploads can dominate and have separate assurance/quality trade-offs.
- The initial window also had reader store timeouts/sync errors and very long search corpus work. This change addresses manifest readiness and selection, not every reader/search bottleneck. Actual post-rollout content-publish trajectories remain the next evidence gap.

## Validation and operation

79 focused tests passed across manifest generation/deltas, access revocation/tenant boundaries, actual-write journaling, no-ops, expiry/ownership, backend pagination, API integration, telemetry and Git scope selection. Typecheck, application/workspace build and changed-file lint passed. Convex dry-run passed before the backend release. Report rollout status separately from these component checks.

Example for a reviewed committed Markdown-only release (the baseline must be the intended already-published commit):

```sh
oncobase publish --site diana --vault /path/to/release --changed-since <published-commit> --assets referenced --dry-run
oncobase publish --site diana --vault /path/to/release --changed-since <published-commit> --assets referenced
```

Axiom dataset: https://app.axiom.co/jlast-ixpg/datasets/oncobase-traces
Corrected experiment trace: `1e756fd395f7343a425cca27bcf02593`.
Rejected experiment trace: `3c929a5fff5f35c4a52c0490f97cae3e`.
Guarded no-op client trace: `9a64fb07f8da1298e769931a377e7b7a`.

Reproduce the read-only manifest experiment with `apps/app/scripts/benchmark-manifest.ts --help`. The session variants deliberately fail if the optimization silently falls back; they compare against the full session hash. Aggregate JSON evidence lives beside this report in `experiments/`.

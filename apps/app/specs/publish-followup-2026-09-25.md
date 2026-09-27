# Local publishing after rollout — September 25, 2026

Historical findings at the dated cutoff below. Later changes and measurements are documented in [the September 27 targeted publishing report](targeted-publish-2026-09-27.md).

**Publishing is substantially faster, but reliable completion still takes more work than the final success message suggests.** The two successful real write commands after the final rollout took **11.99s and 14.90s**. Planning, dependency discovery and uploads are no longer the main cost for small releases. Reader readiness is: it consumed **65.11s of 80.06s (81%)** across six non-dry attempts, including unsuccessful attempts.

Only **two of six non-dry commands returned verified success**. Three committed data but exhausted the 15-second reader-readiness window; another failed during begin and cleanup. Later checks recovered some of these outcomes. These are six attempts across three release trajectories, not six independent releases and not a statistically representative failure rate. A faster nonzero exit does not meet the successful-publication target.

[Interactive timing report](publish-followup-2026-09-25.html) · [Measurements and retained numeric profiles](publish-followup-2026-09-25.json)

## Scope and measurement boundaries

- Evidence cutoff: **September 25, 2026, 15:50 UTC / 8:50am PDT**. Later commands from concurrently active tasks are excluded.
- Final merged rollout: PR [#64](https://github.com/jasonLaster/oncobase/pull/64), commit `47985e58`, production deployment `dpl_89TwMAL8nB7W4VyhgNzNcC3HvKhu`, observed ready September 24 at approximately 03:36 UTC / September 23 at 8:36pm PDT. Inspection during this audit confirmed that deployment still serves production.
- Primary cohort: **15 automatic local profiles after the final rollout**: six non-dry attempts and nine dry-runs, across three release trajectories. Eight dry-runs succeeded; one correctly refused an unresolved Git LFS pointer.
- Transition cohort: **12 additional profiles** from September 23–24 while earlier scoped/cache versions were in use and 0.2.2 was being deployed. These are reported separately. They must not be attributed wholesale to the final version.
- The rollout's three guarded no-op benchmarks, synthetic experiments, and CI job durations are excluded from the real-use statistics. Background legacy API traffic is considered only where it affects the same site's locking or status.
- A “command time” below is the local profiler's measured lifetime through the exit hook. It excludes Node startup/imports before profiling, Git push, content preparation, operator pauses, and subsequent independent verification. Trajectory elapsed time includes the observed gaps and is labeled accordingly. Nested/concurrent spans are never summed as wall time.

The JSON preserves all 27 profiles, file hashes, classifications, phases and outcomes. Profiles contain fixed phase names and numeric metrics rather than document bodies or credentials. This is a reconstruction of available local evidence, not a complete server-side release ledger.

## The full post-rollout trajectories

Times in this table are **PDT**; the evidence appendix uses UTC.

| Release | Sequence | Observed completion and limits |
| --- | --- | --- |
| Contacts, Sep 24, 2:15pm; seven documents | Dry-run **2.93s** → apply **18.06s**, data committed but reader timed out → unchanged dry-run **2.18s** → no-op retry **16.27s**, reader timed out again → retry **1.20s**, begin and abort both HTTP 500 → independent authenticated reader check | The later check confirmed revision **1525**, all seven documents and zero mismatches. Confirmation was observed approximately **187s after the first apply**, or **210s after the first dry-run**. These are observation intervals including investigation/operator time, not measured manifest build durations. |
| Research, Sep 24, 9:46pm; six documents/four result files | Initial referenced-assets dry-run **2.36s** correctly rejected an unresolved LFS pointer reached through the broader document scope. Operator split the release: one-document/four-asset dry-run **1.11s**, six-document/no-asset dry-run **0.76s** → asset-containing apply **17.63s**, committed but reader timed out → unchanged asset dry-run **1.51s** → remaining five document writes **11.99s**, successful → final parallel dry-runs **1.53s / 0.51s**, no differences | Document reader completion occurred **43.4s after the first apply**, or **61.8s after the initial preflight**. Final zero-diff plans were observed about **77.5s after initial preflight**. The four uploaded files passed byte read-back and stored-state verification, but the later successful reader check declared **no assets**. There is no retained successful whole-release reader check covering those four assets. An anonymous file request returned 401, which is not authenticated asset verification. |
| Newsletter, Sep 24, 9:51pm; six documents/two photos | Dry-run **2.61s** → apply **14.90s**, success with automatic embeddings | First-pass success; six document writes and two asset uploads. **36.2s** from dry-run start to profiled publish completion, including approximately 18.7s between commands. The task also recorded a subsequent live rendering check for the photos; that is separate from the 14.90s command. |

The contacts release demonstrates why reporting only the final successful check is misleading. The research release demonstrates why a later successful **narrower** command cannot automatically certify every item in the original release.

## Where the command time went

All six non-dry attempts after the final deployment are retained below. Phase times are seconds, rounded independently.

| Attempt | Local checks/scan | Scoped begin | Embeddings | Document writes | Asset uploads/read-back | Combined completion | Reader wait | Total / result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Contacts initial (P14) | 0.72 | 0.49 | — | 1.38 | — | 0.46 | **15.00** | **18.06**, unverified |
| Contacts no-op retry (P16) | 0.71 | 0.33 | — | — | — | 0.23 | **15.01** | **16.27**, unverified |
| Contacts begin failure (P17) | 0.73 | 0.27 | — | — | — | — | — | **1.20**, failed; includes 0.20s abort |
| Research assets (P21) | 0.73 | 0.36 | — | 0.21 | 1.09 | 0.23 | **15.01** | **17.63**, unverified |
| Research documents (P23) | 0.21 | 0.43 | — | 0.49 | — | 0.24 | **10.62** | **11.99**, verified declared scope |
| Newsletter (P27) | 0.69 | 0.36 | 2.38 | 0.58 | 1.17 | 0.25 | **9.47** | **14.90**, verified |

For the four commands that actually wrote content, verified stored state and finish were reached after approximately **3.06s, 2.63s, 1.38s and 5.43s**. Reader confirmation accounts for the remainder. This is a much stronger guide to the next optimization than the aggregate success time alone.

The five attempts that reached reader waiting issued **156 status requests**. Individual status requests averaged approximately **154–179ms** within each attempt. The reader-wait phases contain **35–37 polls** for the timeouts, 26 for the document success, and 22 for the newsletter success. About **39.3s** of the combined 65.1s reader phase was time outside the status HTTP spans, principally the explicit 250ms polling pauses; about **25.8s** was status HTTP time. Available Server-Timing measurements account for approximately **6.05s** of backend-handler time across those polls.

**Do not interpret polling pauses as 39 seconds that can simply be removed.** The publisher was waiting for a separate projection to become ready. Faster polling mainly adds requests and may save only the final polling interval. We need to make the projection ready earlier and recover its failures, not hammer status faster. Similarly, summed RPC times can overlap and cannot be subtracted from wall time as a network measurement.

## What is better

**Small releases now avoid the whole-vault remote verification loop.** The September 22 read-only baseline took **54.96–65.61s**, including **34.25–36.77s** downloading 7,011 records / 116.27 MB to find 16 selected documents. Current accepted attempts use indexed scope checks and combined completion. Successful post-rollout dry-runs range from **0.51–2.93s**, median **1.52s**. These are different scopes and workloads, so this is evidence of removing the old overhead, not a controlled end-to-end speedup ratio.

**Persistence is being used automatically and is saving work.** Within the same release worktree, the initial dependency scan versus the later warm scan changed as follows:

| Release | Initial scan | Warm apply scan | Parsed/reused on warm scan |
| --- | ---: | ---: | --- |
| Contacts | 2.029s | 0.541s | 7 parsed / 7,188 reused |
| Research asset scope | Initial broad scan 2.169s | 0.553s | 1 parsed / 7,190 reused; scope differs |
| Newsletter | 2.080s | 0.526s | 6 parsed / 7,192 reused |

The comparable contacts/newsletter pairs saved approximately **73–75%** of scan time. These are sequential observations, not rotated cold/warm experiments; filesystem warming also contributes. The dependency metrics directly establish reuse. Document-only selection without asset ownership work was cheaper still: approximately **0.14–0.19s** in the research scope. There is no evidence that users needed to discover an extra cache flag to get these gains.

**The packaged CLI has replaced the temporary publisher scripts for the publish itself.** All six post-rollout non-dry commands used explicit `--vault`, `--files-from` and `--assets`. Five explicitly selected `--embeddings skip`; the newsletter used the default auto mode and spent 2.38s embedding. All used default content verification/cache and automatic coordination. All five attempts that reached completion used `/scoped/complete`. Automatic profiling captured every identified invocation without an explicit `--profile` flag.

**Safety checks are visible and useful.** The LFS pointer was refused before network activity. Selected asset bytes were uploaded and read back; committed-but-unverified publishes returned nonzero. Scope prevented inferred tombstones. No successful scoped command in this cohort reported skipped required uploads. These observations support specific safeguards; they do not prove the absence of all corruption or missed dependencies.

## What is worse, or still disappointing

**The real-use first-command experience is less reliable than the rollout no-op checks suggested.** Three of five commands reaching completion exhausted reader waiting. A no-op retry itself spent 15 seconds waiting because its snapshot was not yet usable. The **1.22–1.57s guarded rollout no-ops** exercised an already-current snapshot; they were not representative of additions, asset releases or stalled rebuild recovery.

There is **no sound evidence of a regression in raw write reliability versus the old publisher**. The old local evidence also contained failed/partial publishes, used different scripts/scopes, and had different success semantics. The new nonzero outcomes partly reflect stricter, more truthful verification. What is demonstrably bad now is the cost and ambiguity of recovering after commit.

**Recovery still requires operator knowledge and scripts.** After a readiness timeout, repeating `publish` reacquires a lock even if the data is already committed. The contacts release needed a custom authenticated `/status` call. The research release used a narrower document command and dry-runs to resolve its state, leaving the asset-reader evidence gap above. A successful dry-run means the plan has no differences; it is not the same as a successful reader check.

**Legacy writers still share the production site.** Retained Vercel logs show legacy `/api/publish/begin` traffic while local scoped operations were being recovered. At **Sep 24 21:16:32 UTC**, a legacy begin is associated with a **60-second Vercel runtime timeout / HTTP 504**. A later scoped begin and its cleanup abort both returned **500**, corroborating the local profile. Their runtime messages expose generic Convex request errors, not the underlying lock reason. Contention or a stranded legacy lock is plausible from timing and code, but cannot be established as the cause with the retained evidence.

This audit does not measure CI performance. The consuming workflow still invokes the broad legacy command, and background legacy traffic matters because it can interact with local writers. Disabling or migrating that automatic writer would remove a source of shared-site interference; it was not changed during this audit.

**The site's single “last publish status” is misleading.** A read-only database inspection during this audit found `lastPublishStatus=failed`, error `aborted: large asset upload requires confirmation`, while `lastPublishedAt` matched the successful newsletter finish and the stored snapshot matched current revision **1528**. There was no active publish owner. The latest status is being overwritten by a subsequent attempt; it is not the outcome of the last verified release. Separately, backend `finishPublish` writes “succeeded” before the client establishes reader readiness. Both directions can mislead an operator.

## What has not changed

- **Many normal changes still require a full manifest rebuild.** Incremental eligibility is limited to existing public document-only scopes of at most 128 pages with a valid preceding snapshot. New pages, assets, private pages and invalid/stale bases fall back. Each of these real release families includes additions and/or assets; their shape cannot establish the previously benchmarked incremental fast path. The telemetry does not retain per-run fallback reasons, so individual build classifications remain unmeasured.
- **A complete snapshot still gets serialized, hashed and stored.** The new code reduces reads for eligible edits; it does not make every step proportional to the change size. Default content-validation caching also inventories/reads outside-owner source bytes when deriving asset visibility. It avoids reparsing everything, not every vault read.
- **Readiness still has a fixed 15-second window.** `--request-timeout-ms` adjusts an individual request, not the overall publish or readiness budget. Increasing it would not cure these reader timeouts. There is no whole-command deadline or durable CLI resume/status workflow.
- **Publication is not an atomic whole-release transaction.** Row writes can succeed before reader readiness; abort cannot roll those writes back. The current ownership checks protect the scoped run but do not eliminate contention with other writers or all ambiguous/lost-response cases.
- **Embeddings remain a real policy trade-off.** Skipping saves time and leaves vectors unchanged; it does not enqueue a background refresh. The five skip commands do not establish current semantic search quality. The newsletter shows inline embedding cost can fit the 5–20s range, but one sample is insufficient for a tail-latency claim.
- **Large asset releases can exceed 30 seconds.** During transition, a 105-document / 236-asset scope uploaded 235 assets and took **49.15s**: 26.03s uploading/verifying assets, 3.07s writing documents, 2.22s stored-state verification, and 15.24s reader waiting. Selected asset bytes totaled approximately **33.42 MB**. That run straddled the 0.2.2 deployment and is not a clean final-version regression test. It still demonstrates why a universal sub-30-second completion promise needs size/workload limits.

## Observability coverage and gaps

| Source | What was obtained | What it cannot establish |
| --- | --- | --- |
| Automatic local profiles | All 27 identified default-directory profiles through the cutoff; nested phases, bytes, outcomes, cache counters, response codes and numeric Server-Timing. No dropped spans reported. | No CLI version, effective-policy receipt, source SHA, durable release/run ID or readiness reason recorded in the profile. Mode/scope/versions require command-history reconstruction. Process startup is excluded. |
| Local task trajectories | Actual commands, polling outputs, preflight refusals, retry sequences and later independent verification; four task histories cover the six transition/final release families. | Other machines or unrecorded shell runs may exist. Operator gaps cannot be attributed to the server. A final narrative alone is not accepted as proof when the underlying scope/check is narrower. |
| Vercel runtime/request logs | **208 unique retained request IDs** after deduplicating repeated CLI pages and middleware/serverless records; route/status/deployment corroboration, including the legacy 60s timeout and scoped begin/abort 500s. | This is a retained sample, not an exhaustive request ledger or six complete distributed traces. Some queries returned repeated pages; older transition queries were rejected. Request records had no populated trace IDs. Raw HTTP 200 does not mean reader-ready. |
| Vercel metrics | Queried the function-invocation metric schema and attempted the production publish-count query. | Historical query rejected with `payment_required`: Observability Plus required. No aggregate latency percentile or account-wide success-rate claim is made. |
| OpenTelemetry/drains | Production environment-name inventory contained no `WIKI_BACKEND_TRACING`/OTLP exporter variables; drain inventory returned **zero configured drains**. | Instrumented code is present, but no configured exported backend trace history was available. Local trace IDs plus Server-Timing are not persisted cross-service traces. |
| Convex history | A bounded read-only log stream returned **1,023 events**, covering Sep 25 **14:25:33–15:51:49 UTC**. | This retained window missed the publish episodes. No historical per-release `publish.manifest` build durations, incremental flags, scheduler delays, quota/OCC events or fallback reasons could be recovered through it. Absence of errors in that later window says nothing about the earlier failures. |
| Current database projection | No active owner; revision and snapshot both 1528; last status overwritten by a legacy abort. | Current state cannot reconstruct previous ownership, queue state or the moment each historical snapshot became ready. |

The most important missing span is **finish → scheduled build start → delta/full decision → build phases → install → reader-ready**, correlated to the client release. We can measure the client waiting precisely but cannot divide that delay into scheduling, full inventory, retries, storage and superseded builds for these historical publishes.

The existing builder log records aggregate phases but suppresses the exception into a generic “build deferred” message, and the status endpoint returns `ready:false` without distinguishing absent snapshot, stale revision, failed build or active lease. That makes a timeout expensive to diagnose even when the user has all the local spans.

## Priorities and trade-offs

1. **Make post-commit recovery durable and read-only.** Persist a release receipt with commit/revision, scope digest, policy, content-verified state and reader status. Add a status/wait command that checks the original entire scope without reacquiring a write lock. Report `committed, reader pending` explicitly. A larger wait budget can reduce false failures, but it must remain visible as latency rather than being counted as a fast publish.
2. **Measure and repair the manifest readiness path.** Retain fixed-name, content-free build events with a correlation ID, queue delay, incremental eligibility/fallback reason, attempts, install/rejection reason and elapsed phases. Retry failed/superseded work with a bounded durable policy. Extend incremental handling to common additions/assets only after equivalence and visibility tests; those are less simple than replacing an existing public page. Merely changing the polling interval has low ROI.
3. **Separate last attempt from last verified release; arbitrate all writers.** Preserve both outcomes in a small run ledger. Return typed conflict/ownership errors instead of generic 500s and distinguish failed acquisition from an owned abort. Disable or migrate the obsolete automatic broad publisher so local scoped work does not compete with it. This removes irrelevant work and status pollution, at the cost of losing that automatic publishing path until its replacement exists.
4. **Close verification-scope gaps introduced during recovery.** A release split around an LFS pointer needs a receipt covering the union of the document and asset subscopes. `--assets none` is an intentional scope reduction, not proof that all references remain valid. Preserve the pointer guard; explain which selected document brings the asset into scope so the operator can hydrate it or deliberately narrow the release.
5. **Make evidence automatic and retain it.** Keep local profiles on by default, add version/effective options and structured failure/commit state, and retain minimal server events long enough for a weekly review. Export sanitized publish traces at an appropriate sampling policy; no content, tokens or clinical paths. A lightweight run/event ledger may answer the important questions more cheaply than purchasing general-purpose observability solely for this workload.
6. **Optimize remaining local work only after readiness.** Default cache adoption is already good. Optional metadata validation would trade filesystem trust for smaller scan savings while reader waiting dominates; it should remain opt-in. No concurrency override was used in these six small attempts, and their measured write phases do not justify higher concurrency. The earlier bulk experiment's eight-worker quota trade-off remains relevant for large document bodies.

Acceptance should track **time to verified completion per release**, first-attempt verified success, and whether the final verification covers the original scope, alongside command time. Use separate cohorts for existing-page edits, additions, asset changes, no-ops with current snapshots, no-ops with stale snapshots, and bulk maintenance. Count failed/partial attempts and recovery work. The observed successful commands meet 5–20 seconds; the full trajectories and sample size do **not** establish that all routine releases reliably meet it, let alone sub-second publishing.

## Transition cohort: retain the failures, avoid rollout confounding

| Release, UTC | Actual sequence | Interpretation |
| --- | --- | --- |
| Initial research, Sep 23 22:36 | 2.41s plan → **18.21s** apply with 15.11s reader timeout → 1.25s unchanged plan → subsequent explicit content/reader verification | Eight documents were written. This preceded the final cache/coordination rollout; the later check is separate from the failed command. |
| Expanded research, Sep 23 23:00–23:03 | 0.06s dirty-checkout refusal → 1.32s plan → **15.42s** successful apply → 1.26s unchanged plan | Twelve documents; 12.18s reader waiting. Validates improvement from the older whole-site scripts, not the final 0.2.2 incremental path. |
| Bulk sources, Sep 24 02:34–02:41 | 0.07s dirty-checkout refusal → 2.86s plan → 2.42s asset-budget refusal → **49.15s** apply, stored state correct but reader timeout → independent checks initially not ready, subsequently ready → **4.02s** verified no-op | 105 documents, 236 selected assets, 235 uploads. Backend/API/CLI upgrades occurred during this trajectory. The zero-write retry is not a 4-second bulk upload. |

## Evidence references

- Current implementation inspected: [CLI publish](../../../packages/oncobase/src/publish.ts), [profile format](../../../packages/oncobase/src/publish-profile.ts), [publish API](../server/publish-api.ts), [site completion/status](../convex/sites.ts), [manifest builder](../convex/manifestBuilder.ts), [build queue](../convex/lib/manifestRevision.ts), [snapshot install](../convex/manifestCache.ts), [backend tracing](../server/backend-tracing.ts).
- Prior baseline: [local read-overhead timing](local-publish-timing-2026-09-22.md), [original local-attempt audit](publish-audit-2026-09-22.md), [strategy experiments and limitations](publish-dependency-experiments-2026-09-23.md). CI results in the older audit are not used as this report's performance baseline.
- Default local profile source: `/Users/jasonlaster/.config/wiki/publish-profiles/`; exact basenames and SHA-256 hashes are in the JSON. Rollout no-op controls remain in `/tmp/publish-strategy-experiment/merged-smoke/`.
- Trajectory sources: tasks `01a0d061-0b75-75d1-9975-4c32a70ff39e` (transition), `01a0d19f-c21a-75f1-a800-924cc5480243` (contacts), `01a0d6cb-dd24-79f0-8092-eed66116990b` (research), and `01a0d6e3-a074-7dd0-b7c6-fbe060bd058f` (newsletter). The contacts reader proof is the tool output at **2026-09-24T21:18:39.737Z**; the research final parallel checks are at **2026-09-25T04:48:15.369Z**.
- Operational retrieval metadata and private raw request logs are retained locally under `/tmp/publish-followup-20260925/`. The report includes only operational summaries and numeric profiles; no secrets or document contents. The audit made no publish/content writes or runtime changes.

## Invocation appendix

The following table includes guard refusals, dry-runs, retries and failed commands. “Writes” counts observed document/asset HTTP requests; it is not an independent transaction ledger. UTC start timestamps come from automatic profile filenames.

| ID | Cohort | Start UTC | Release / mode | Seconds | Outcome | Doc / asset requests |
| --- | --- | --- | --- | ---: | --- | ---: |
| P01 | transition | 09-23 22:36:24 | Initial research / dry-run | 2.41 | plan | 0 / 0 |
| P02 | transition | 09-23 22:36:38 | Initial research / publish | 18.21 | reader-timeout | 8 / 0 |
| P03 | transition | 09-23 22:37:26 | Initial research / dry-run | 1.25 | unchanged | 0 / 0 |
| P04 | transition | 09-23 23:00:47 | Expanded research / dry-run | 0.06 | dirty-checkout | 0 / 0 |
| P05 | transition | 09-23 23:02:14 | Expanded research / dry-run | 1.32 | plan | 0 / 0 |
| P06 | transition | 09-23 23:02:35 | Expanded research / publish | 15.42 | verified | 12 / 0 |
| P07 | transition | 09-23 23:03:02 | Expanded research / dry-run | 1.26 | unchanged | 0 / 0 |
| P08 | transition | 09-24 02:34:25 | Bulk sources / dry-run | 0.07 | dirty-checkout | 0 / 0 |
| P09 | transition | 09-24 02:34:52 | Bulk sources / dry-run | 2.86 | plan | 0 / 0 |
| P10 | transition | 09-24 02:37:22 | Bulk sources / publish | 2.42 | asset-budget-guard | 0 / 0 |
| P11 | transition | 09-24 02:37:50 | Bulk sources / publish | 49.15 | reader-timeout | 105 / 235 |
| P12 | transition | 09-24 02:41:02 | Bulk sources / publish | 4.02 | verified-noop | 0 / 0 |
| P13 | post-rollout | 09-24 21:15:10 | Contacts / dry-run | 2.93 | plan | 0 / 0 |
| P14 | post-rollout | 09-24 21:15:32 | Contacts / publish | 18.06 | reader-timeout | 7 / 0 |
| P15 | post-rollout | 09-24 21:16:05 | Contacts / dry-run | 2.18 | unchanged | 0 / 0 |
| P16 | post-rollout | 09-24 21:16:15 | Contacts / publish | 16.27 | reader-timeout-noop | 0 / 0 |
| P17 | post-rollout | 09-24 21:18:08 | Contacts / publish | 1.20 | begin-and-abort-500 | 0 / 0 |
| P18 | post-rollout | 09-25 04:46:57 | Research / dry-run | 2.36 | lfs-pointer-guard | 0 / 0 |
| P19 | post-rollout | 09-25 04:47:10 | Research documents / dry-run | 0.76 | plan | 0 / 0 |
| P20 | post-rollout | 09-25 04:47:10 | Research assets / dry-run | 1.11 | plan | 0 / 0 |
| P21 | post-rollout | 09-25 04:47:16 | Research assets / publish | 17.63 | reader-timeout | 1 / 4 |
| P22 | post-rollout | 09-25 04:47:39 | Research assets / dry-run | 1.51 | unchanged | 0 / 0 |
| P23 | post-rollout | 09-25 04:47:47 | Research documents / publish | 11.99 | verified-documents | 5 / 0 |
| P24 | post-rollout | 09-25 04:48:13 | Research assets / dry-run | 1.53 | unchanged | 0 / 0 |
| P25 | post-rollout | 09-25 04:48:13 | Research documents / dry-run | 0.51 | unchanged | 0 / 0 |
| P26 | post-rollout | 09-25 04:51:19 | Newsletter / dry-run | 2.61 | plan | 0 / 0 |
| P27 | post-rollout | 09-25 04:51:40 | Newsletter / publish | 14.90 | verified | 6 / 2 |

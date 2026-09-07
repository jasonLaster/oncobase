# Backend performance matrix — September 7, 2026

## Measured improvements

Two changes address substantial measured costs: reuse a versioned public manifest snapshot, and prepare the public search corpus once per cache lifetime instead of redacting and splitting it on every search. Cold search overlaps exactly one next database read with preparation of the current page.

Three alternating baseline/candidate pairs against the same deployed Convex database produced these response-completion medians:

| Use case | Baseline | Improved | Reduction | RPCs before → after |
| --- | ---: | ---: | ---: | --- |
| Full public manifest | 3,212 ms | 534 ms | 83.4% | 34 → 2 |
| Unchanged manifest (304) | 3,183 ms | 185 ms | 94.2% | 34 → 2 |
| Cold exhaustive search | 13,943 ms | 10,532 ms | 24.5% | 32 → 32 |
| Warm matching search | 2,295 ms | 187 ms | 91.9% | 1 → 1 |
| Warm no-match search | 2,590 ms | 202 ms | 92.2% | 1–2 → 1 |

All paired full-manifest hashes matched, including 6,654 public pages and 1,076 PDF assets. All matching-search response hashes matched, including ordering, snippets, line numbers, match positions, and the 100-result limit. All paired searches were exhaustive. The no-match response hashes also matched. Volatile generated timestamps and the derived manifest-hash field were excluded from the equality digest; content and order were retained.

### Why these changes

The manifest traces showed 30 sequential document enumeration RPCs plus three asset RPCs and the gate lookup. Even an unchanged conditional request did that work. A valid snapshot now needs only gate and snapshot-version queries; a 304 reads no snapshot body. A full response reads the stored 3,630,883-byte snapshot once.

Search transferred approximately 108 million content characters. Separate CPU-phase probes attributed 1.9–2.1 seconds to repeated redaction/preparation and roughly 84–110 ms to matching. Prepared, redacted lines now live in the existing 60-second public corpus cache. Changes in redaction rules invalidate that prepared cache as soon as the independently cached configuration refreshes (15 seconds). Raw and prepared corpus copies are not both retained. Session corpora remain isolated and uncached across requests.

An initial implementation made cold search slower by preparing each page before requesting the next. It was rejected after paired measurements. The final implementation starts exactly one next read before preparing the current page, and propagates read failures while evicting failed corpus promises for retry.

The snapshot functions and optional schema fields already existed in the deployed backend from an earlier investigation but were absent from main. This change restores that implementation to source control and connects the HTTP reader to it. Manifest-affecting document/asset writes invalidate the snapshot in the same transaction; revision and format guards reject stale builds. Builds are coalesced, have a retry lease, and use a service credential. Session requests never use public snapshots. Missing, stale, or unreadable snapshots fall back to live enumeration. Storage URLs never reach the reader.

## Method and limits

The application handlers ran locally under Bun with actual production Convex reads. Real OpenTelemetry spans were exported through OTLP HTTP to a local collector at 100% sampling. Added nested phase spans cover search corpus loading, preparation, matching, and snapshot reading. Database spans record function names, row counts and content-character counts, never arguments, bodies, document paths, cookies, storage URLs or error text. These are controlled application measurements, not production latency percentiles or a concurrent load test. Convex RPC duration includes network and backend time; it does not isolate individual database reads within a function.

The broad baseline used 22 scenarios, three runs each. The final focused experiment used five scenarios, three pairs each (30 requests), alternating variant order. Baseline HTTP code came from commit `07ef34c4`; both variants used the same current Convex deployment. The focused experiment set `WIKI_SEARCH_CORPUS_WAIT_MS=60000` for both versions solely to require equal exhaustive responses. Product timeout remains 15 seconds with its existing indexed fallback. Earlier mixed indexed/exhaustive and still-warming samples are not used to calculate the improvements above.

The corpus changed from 6,652 to 6,654 pages during investigation. Only contemporaneous pairs with matching hashes support the improvement percentages. Separate broad sweeps are regression observations, not precise A/B speed claims. One candidate sweep stopped after a connection reset during the 100-page batch; its partial output was preserved and a fresh sweep was run rather than silently retrying timed requests.

Authenticated gate-only public reads, anonymous and missing-session denials were tested live. Real signed-in permission cohorts, write throughput, expensive LLM/chat generation and external medical integrations were not benchmarked. Authorization, configuration refresh, failures, stale snapshots and tenant isolation have regression coverage. No production documents or user accounts were created or changed by the matrix.

Cold search still transfers the full corpus and consumes substantial CPU/memory during preparation. Process RSS samples from alternating variants share one process and are not suitable for a memory reduction claim. No such claim is made. Page batches still fan out into one query per document; this remains visible in the data, but was not changed without stronger latency evidence and response-size analysis.

## Reproduction

Run from the repository root with the intended backend URL/site configured. To exercise snapshots, supply the matching `WIKI_PREFETCH_SECRET` only to the process, never in command history or committed files.

```sh
bun apps/app/scripts/profile-backend-matrix.ts live .playwright/backend-matrix/run 3
# Optional fifth argument filters fixed scenario names:
bun apps/app/scripts/profile-backend-matrix.ts live .playwright/backend-matrix/search 3 '^(search-)'
```

For paired reproduction, write the baseline wiki-api source from `07ef34c4` to a temporary sibling module and set `WIKI_PROFILE_BASELINE_MODULE` to that module path. Use `WIKI_SEARCH_CORPUS_WAIT_MS=60000` for the exhaustive comparison; remove the temporary module afterward. Each run constructs fresh clients/handlers; warm cases reuse their preceding cold handler. The profiler records response readiness and full streaming completion separately.

Raw `samples.json` and OTLP `spans.json` remain under ignored `.playwright/backend-matrix/`: `baseline`, `baseline-search-phases`, `baseline-search-exhaustive`, `paired-final`, and `candidate-full-retry`. Only aggregate evidence is committed. Those files contain timings, counts, hashes and fixed scenario/span names, not response bodies or document identifiers.

## Validation

- 186 app unit tests passed, including nested trace parentage/aggregate-only attributes, failed pagination retry, preparation overlap, redaction changes, corpus expiry and snapshot HTTP query counts.
- 65 wiki-content tests passed, including snapshot equivalence, 304 without reading storage, session exclusion, live fallback, private headers and authorization isolation.
- TypeScript, lint (zero errors; 14 existing warnings), production build and browser bundle budget passed.
- Four standalone Chromium checks passed against the configured backend: password gate, API access and rendered reader navigation.
- Convex deployment dry run passed with no index deletions. Convex CLI standalone typecheck requires an absent convex/tsconfig.json, so the dry run used `--typecheck disable`; the application TypeScript check passed separately.

## Full use-case sweep

Three observations per scenario; median full-response milliseconds. Broad sweeps were not interleaved, so only the focused paired table above establishes improvement sizes. Prefetch was disabled in the baseline environment and enabled with the service credential for the candidate; its latency is not comparable.

| Scenario | Baseline ms | Candidate ms | Candidate status | Candidate RPCs |
| --- | ---: | ---: | --- | --- |
| gate-denied | 110 | 170 | 401 | 1 |
| session-public | 0 | 0 | 200 | 0 |
| session-missing | 0 | 0 | 401 | 0 |
| auth-session-anonymous | 0 | 0 | 200 | 0 |
| manifest-cold | 4016 | 889 | 200 | 2 |
| manifest-revalidate | 4230 | 226 | 304 | 2 |
| page-single-cold | 296 | 320 | 200 | 3 |
| page-single-warm | 209 | 216 | 200 | 2 |
| pages-25 | 1017 | 806 | 200 | 26 |
| pages-100 | 755 | 894 | 200 | 101 |
| page-missing | 745 | 678 | 200 | 5 |
| page-denied | 315 | 363 | 200 | 3 |
| page-copy | 193 | 236 | 200 | 2 |
| prefetch-public | 94 | 227 | 200 | 2 |
| timeline | 307 | 349 | 200 | 3 |
| diagnostic-studies | 191 | 258 | 200 | 2 |
| dicom-studies | 287 | 251 | 200 | 2 |
| dicom-comparisons | 197 | 221 | 200 | 2 |
| search-cold | 16449 | 15333 | 200 | 32,33 |
| search-warm | 6712 | 3088 | 200 | 1,2 |
| search-no-match-warm | 2507 | 212 | 200 | 1,2 |
| download-markdown-25 | 1613 | 1148 | 200 | 5 |

All 66 requests completed with the intended status codes. Two of three candidate cold searches reached the normal 15-second budget and returned the existing indexed fallback; their following warm searches waited for the corpus to finish. The third cold search and all six subsequent search responses were exhaustive. This remaining cold-start limitation explains the broad sweep's 3,088 ms warm median; the focused comparison starts warm measurements only after complete exhaustive preparation. The 25-page download was measured through body completion, not merely header readiness. Non-targeted query counts remained unchanged, apart from configuration-cache expiry and intentionally enabled prefetch. These results support keeping the implementation limited to the two large costs identified by the traces.

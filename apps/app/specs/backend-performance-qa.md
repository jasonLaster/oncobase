# Backend performance investigation — September 7, 2026

Prepared on `main`, based on `78d78e04`, in `/tmp/oncobase-backend-performance`. Production deployment and post-change measurements remain unverified. The original checkout's unrelated edits are untouched.

## Findings and changes

The public navigation manifest is the clearest measured backend bottleneck. Two read-only runs against the configured production backend returned 6,652 public documents and 1,076 PDF assets. Each request invoked 30 sequential `documents:listManifestPage` queries and three PDF-visibility queries. The document scan dominated elapsed time; asset enumeration already overlaps it.

The query previously paginated the entire site's document inventory and discarded restricted rows afterward. It now uses the existing `by_site_sensitive_slug` index with a site equality and `sensitive < true` bound. This includes both unset and explicitly false sensitivity, preserving the existing public visibility rule. The server sorts the assembled pages by slug so the index's sensitivity grouping does not change ordering or ETags. Deletion and tenant checks remain in place. No schema change, backfill, or broader public-content cache is introduced.

The index improvement is verified with the Convex test runtime, including pagination across unset/false values, restricted documents before the public documents, tombstones, foreign/unscoped rows, session scope, and unknown sites. It has **not** been deployed or timed against production. The previous 30-call count cannot be presented as a measured post-change reduction. A simple 500-row estimate suggests roughly 14 pages for 6,652 public rows, but byte limits and tombstones may require more.

Signed-in manifests have a second avoidable cost: sensitive documents are checked once as asset owners and again as pages. The implementation now shares checks within one manifest response, checks only sensitive asset owners, and runs chunks of at most 100 slugs with at most four concurrent chunks. It retains the all-owners rule, requires owner-document existence, omits missing access results, and does not share authorization decisions across requests/users. A regression changes permissions between consecutive requests and verifies that the second response removes denied pages and assets.

Cold page batches also share an in-flight redaction configuration lookup, keyed by client and site. The previous cache was filled only after the query completed, allowing simultaneous body reads to fan out into duplicate config queries. A 25-page controlled regression now needs two site-config reads total: the gate read and one redaction-config read. Failed redaction lookups fail the request and are evicted for retry, instead of caching fallback configuration after a database error. The live sample did not reproduce config fan-out, so this is a tested concurrency fix, not a demonstrated live latency gain.

## Evidence

### Signed-in manifest fixture

Same 850 restricted pages and 850 PDFs, with a simulated 20 ms latency per access RPC. Final comparison, one sample per version:

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Request duration | 401 ms | 80 ms |
| Access RPCs | 18 | 9 |
| Slugs checked | 1,700 | 850 |
| Peak concurrent access RPCs | 1 | 4 |
| Pages / PDFs returned | 850 / 850 | 850 / 850 |
| Manifest hash | `974d98bea38b8b899274db55` | `974d98bea38b8b899274db55` |

This measures scheduling and redundant work under controlled latency. It does not establish production signed-in percentiles or Convex throughput under concurrent user load.

### Live read-only diagnostic samples

The candidate application in these runs still called the **unchanged deployed Convex functions**, so neither sample contains the new public-manifest index optimization. Timing variation between these sequential samples is not an optimization claim.

| Use case | Baseline application | Candidate application | RPC counts, both samples |
| --- | ---: | ---: | --- |
| Public manifest | 3,525 ms | 4,486 ms | 30 document pages + 3 PDF pages + 1 site config |
| Cold batch, 25 public pages | 905 ms | 806 ms | 25 document lookups + 2 site config |
| Warm batch, same 25 pages | 810 ms | 700 ms | 25 document lookups + 1 site config |

Document-manifest RPCs consumed 3,383 / 4,340 ms summed time, compared with 534 / 379 ms for overlapping PDF enumeration. No accounts, visits, publications, or backend data were written. The profiler signs a process-local gate cookie using a random local secret; it never prints or persists the cookie, document payloads, slugs, or credentials.

## OpenTelemetry

Manual tracing covers requests entering `createWikiApiHandler` and their Convex query/action/mutation calls. A private tracer provider and explicit parent contexts prevent unrelated AI SDK instrumentation from becoming enabled. SDK/exporter initialization is deferred until tracing is enabled. Concurrent requests remain isolated through AsyncLocalStorage.

Enable on the server and restart:

```sh
WIKI_BACKEND_TRACING=1
WIKI_BACKEND_TRACE_SAMPLE_RATE=0.1
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
# Optional collector authentication, supplied securely through the environment:
# OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer ...
```

Use sample rate `1` for a short diagnostic run. The default is `0.1`. Export uses OTLP/HTTP with a two-second exporter timeout. Vercel flushes after sending the response; long-running servers use batch export. No hosted collector has been configured or contacted by this work. An actual HTTP export was verified against a local test collector.

Optional aggregate response timing is independent of sampling:

```sh
WIKI_BACKEND_TIMING=1
```

It appends `backend`, `convex`, and `convex-count` Server-Timing entries while preserving existing search timing and cache headers. `convex` is **summed completed RPC time**, so overlapping calls can make it exceed total elapsed time. Do not subtract it from request duration to infer CPU time.

Trace attributes contain fixed allowlisted route names, HTTP method/status, function names, operation type, and call counts. Arguments, results, URLs/query strings, IDs, cookies, error messages, and exception stacks are excluded. Unknown/dynamic routes become `/api/other`. Span errors record status only. `convex.calls.pending` identifies calls still running when the response becomes ready, including work left behind by timed fallbacks.

Limits: API spans end when the Response is ready, not when a streaming body finishes. HTML-shell startup, individual database reads inside a Convex function, blob/model network calls, and CPU subphases are not separately instrumented. Root span gaps show time outside the recorded Convex RPCs; use Convex function metrics for internal read costs. Incoming external trace context is not joined. This keeps the initial instrumentation bounded and leaves full distributed propagation as a separate change.

## Reproduction and validation

```sh
bun apps/app/scripts/profile-backend.ts fixture
# Explicitly opt into read-only calls to the configured backend, including
# the app's production URL fallback when no URL is configured:
bun apps/app/scripts/profile-backend.ts live
```

Both modes accept an optional third argument pointing to a baseline module (`packages/wiki-content/src/server.ts` for fixture, `apps/app/server/wiki-api.ts` for live). Run each baseline in its own process to keep module caches cold and preserve its relative imports.

Validation passed:

- 175 app unit tests and 62 wiki-content unit tests.
- App TypeScript check, production build, and browser bundle budget.
- Four standalone Chromium checks against the configured backend, covering gate behavior, API access, and page rendering.
- App lint: no errors; 14 existing warnings. Focused changed-file lint: no findings.
- Actual OTLP export, request parent isolation, sanitized errors/payloads, preserved response headers, and failing observer isolation.

Convex deployment and production post-change measurements are still required to establish the index improvement. Re-run live manifest profiling after deploying the query and compare count, latency, page set, ordering, ETag behavior, and private/public access. The index already exists; normal deployment is sufficient. A cursor from an in-flight old-index pagination may fail during cutover and use the existing manifest fallback; a fresh request starts with a new cursor.

## Next experiments

1. **Small metadata projection:** the manifest still reads document rows containing bodies, raw content, and potentially embeddings even though it returns only metadata. A separate metadata table maintained in the same transaction as every document write could cut read bytes substantially. Validate all upsert/delete/restore paths, backfill completeness, and atomic readiness before switching readers; avoid a partially populated navigation inventory. Measure read bytes and execution time to decide whether this is worth the extra write complexity.
2. **Signed-in session identity:** `getAllowedSlugs` still scans all document metadata in 100-row pages before hashing permissions. It can use a sensitive-only indexed projection and evaluate authorization alongside that scan, but must preserve the cache-key changes caused by permission/document changes. Trace actual signed-in use before choosing between that optimization and a versioned permission fingerprint.
3. **Page-body batching:** a 25-page warm request still makes 25 document queries. A bounded multi-slug Convex query could reduce transport overhead, but must retain exact/index fallback, denied-page behavior, redaction, read/response-size limits, and per-page failure semantics. Measure this separately from increasing client-side concurrency.

Technical references: [Convex value ordering](https://docs.convex.dev/database/reading-data), [Convex index ranges](https://docs.convex.dev/database/reading-data/indexes/), [OpenTelemetry manual instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), and [Convex test runtime](https://docs.convex.dev/testing/convex-test).

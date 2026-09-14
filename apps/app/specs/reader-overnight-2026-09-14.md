# Overnight reader startup work — September 14, 2026

Target: initial usable reader below 500 ms while preserving client-side React, LiveStore, access isolation, and article continuity. Baseline production commit: `050c1ac3`.

## Current checkpoint — indexed identity deployed

The target is not yet met for the ordinary signed-in reader in the existing Chrome profile. Latest application release: `23d04cfefcf80cd5f9d17c1c9b9d0e205fbb1ed5` (READY, `dpl_4YW5KwQYbvMXoKS7fRdXPoL5d29J`, production aliases verified). The indexed backend query was deployed separately from pushed commit `7e6611ce`. First measured post-deploy article readiness fell from about 19 seconds to 2295 ms; two warm signed-in loads measured 1412 and 1279 ms. The last 750 ms is the existing-leader fallback in this profile. Public persisted runs measured 876, 742 and 1247 ms (the last had 753-ms HTML delivery). Do not confuse the earlier small-fixture sub-500-ms result with these live results.

Signed-in diagnostic memory-mode runs measured 478, 1266 and 522 ms. All still use React, the same LiveStore schema, validated identity and normal access checks, but this mode is opt-in and bypasses persisted storage for one document. The slow sample had an 850-ms backend identity request. One fast diagnostic result is not a reliable sub-500-ms claim or authorization to remove persistence by default.

The next highest-value backend candidate is to combine indexed sensitive pagination and the existing batch permission evaluator in one query. The current API reads sensitive document metadata, then four access queries read the same documents again. Share the exact existing predicate rather than create a new authorization policy, compare old/new allowed-slug sets including all permission variants and tenant/deletion rules, deploy the optional/new backend query before switching the API, and preserve fresh cache-key validation. No permission fingerprint or credential-lifetime change is needed. Persistence remains a separate bottleneck: normal public boot took about 440–530 ms after adapter selection; the signed-in profile has an existing leader that never answers. A local changed-worker-version probe emitted no SharedWorker error event, so an early error listener does not solve that case; the temporary test instrumentation was removed. Do not steal locks, delete caches, re-enable the unsafe snapshot fast path, or close/reload the user's other tabs to improve a benchmark.

## First release — deployed `02afed7f`

- Reuse a valid same-response public page payload to identify the public store on an explicitly public cold visit. Automatic visits may do so only when the server explicitly verified no account session and the gated HTML response is private/no-store. Shared HTML and saved browser identities cannot choose automatic scope. Identity refresh continues in the background, and the normal LiveStore boot path consumes the data.
- Deduplicate account lookups within one incoming request and site. Every subsequent request revalidates the session; errors are not retained across requests.
- Load the 76.0 KiB gzipped math engine only for documents with possible math. Prefetch it from the initial payload when needed. Server rendering retains its synchronous math support; an update introducing math keeps the previous article mounted until the engine arrives. Currency, fenced math, raw HTML math and equations retain their rendering behavior.
- All six vendor bundle URLs and bytes remain unchanged under an ordinary application edit, with no imports back into application chunks. Browsers can retain HTTP and bytecode caches; bytecode reuse itself is browser-controlled and was not measured.

## Controlled measurements

Article readiness is the visible React `.wiki-markdown` body, followed by 900 ms observing retractions and DOM-node continuity. Navigation records visible sidebar links. Each cell has three alternating-order samples, 48 loads total. The fixture uses fresh browser contexts for cold visits and reloads each context, a shared Chromium process, two synthetic pages, loopback HTML (about 1–4 ms), 200 ms identity latency, 400 ms manifest latency, and 350 ms body latency. Both distributions use the current synthetic server and the real gated-response handler; the baseline client ignores the new verified flag. Raw synthetic evidence is in `reader-overnight-2026-09-14.json`.

| CPU | Scope | Visit | Article before → after | Navigation before → after |
| --- | --- | --- | --- | --- |
| Normal | Explicit public | Cold | 476 → 281 ms | 469 → 274 ms |
| Normal | Explicit public | Reload | 134 → 132 ms | 132 → 130 ms |
| Normal | Automatic signed out | Cold | 466 → 287 ms | 460 → 280 ms |
| Normal | Automatic signed out | Reload | 316 → 134 ms | 312 → 131 ms |
| 4× slower | Explicit public | Cold | 715 → 634 ms | 693 → 609 ms |
| 4× slower | Explicit public | Reload | 320 → 311 ms | 313 → 303 ms |
| 4× slower | Automatic signed out | Cold | 704 → 618 ms | 680 → 594 ms |
| 4× slower | Automatic signed out | Reload | 402 → 304 ms | 394 → 297 ms |

All 48 loads had zero page-body requests, errors, article retractions, or body-node replacements. The earlier explicit-public-only experiment independently reduced normal cold loads from 473 to 289 ms. The math split's demonstrated benefit is 76 KiB less initial compressed JavaScript; this loopback experiment does not establish an additional CPU improvement from it.

These are controlled medians, not a production or device-wide sub-500-ms claim. Slow cold CPUs remain above target, and production HTML latency, network bandwidth and real document complexity still need accounting.

## Validation

- 18 Chromium and 18 WebKit browser checks passed: bootstrap fallback, delayed identity, restricted-account routes, public/session isolation, no store restart after identity refresh, currency/math rendering, optional math requests and article continuity while math loads.
- 38 focused bootstrap/session/math-loader unit tests and 48 renderer/session parity tests passed.
- Production build, app and shared Markdown typechecks, changed app-file ESLint, bundle budget and ordinary-edit vendor-cache check passed.
- React Doctor reported no errors. Warnings include existing WikiPage complexity and a two-page benchmark array lookup; moving the renderer preserved its public helper exports (Fast Refresh warnings). The browser wrapper intentionally retains previous committed document props for continuity, so they cannot be derived from the new props while math is pending.

## Safety and rejected shortcuts

- Do not replace the article during bootstrap-to-live updates or weaken cache partitioning.
- Do not assume a public page means the current account is signed out.
- Directly calling `loadSqlite3Wasm` to warm the worker would create an extra SQLite instance: the installed loader is not memoized.
- Pre-creating a LiveStore worker can lose its ready message before provider listeners attach. Avoid a new worker-pooling protocol solely for a benchmark.
- Keep LiveStore's fast snapshot path disabled: rapid reloads previously exposed partial SQLite snapshots.
- The math vendor group must have lower priority than Markdown so shared helpers do not pull the optional math engine into the eager graph.

## Module preload experiment

The build plugin follows LiveStoreRoot's actual static import graph and adds module preloads to reader HTML. It excludes the already preloaded entry graph and all dynamic imports, so the optional math engine remains lazy. It neither executes modules nor starts a database. Login, terms, and independent DICOM routes skip these hints. Six focused Chromium checks and six WebKit checks passed, including a held entry script proving the early downloads, no early API/WASM requests, one reader-module request, and standalone route isolation.

Two 48-load comparisons against the first release use the same fixture as above. The second adds 50 ms of Chromium network latency without bandwidth throttling; it isolates discovery waterfalls and is not a full mobile-network simulation. All 96 loads had zero errors, retractions and node replacements. Median article readiness:

| Added latency | CPU | Scope | Cold before → after | Reload before → after |
| --- | --- | --- | --- | --- |
| 0 ms | Normal | Public | 282 → 269 ms | 132 → 129 ms |
| 0 ms | Normal | Automatic | 283 → 269 ms | 128 → 130 ms |
| 0 ms | 4× | Public | 621 → 623 ms | 314 → 302 ms |
| 0 ms | 4× | Automatic | 610 → 606 ms | 311 → 299 ms |
| 50 ms | Normal | Public | 779 → 707 ms | 195 → 193 ms |
| 50 ms | Normal | Automatic | 772 → 714 ms | 190 → 193 ms |
| 50 ms | 4× | Public | 1022 → 928 ms | 363 → 364 ms |
| 50 ms | 4× | Automatic | 1021 → 915 ms | 360 → 360 ms |

The gain is material for cold network discovery, modest on loopback, and absent on already cached reloads. It does not by itself meet the target with added latency.

## Deferred fallback SQLite runtime

The existing adapter patch now delays the in-memory adapter's module-level SQLite initialization until that adapter actually starts. Normal persisted startup creates one main-thread SQLite runtime instead of two; fallback consumers still share one promise. No storage protocol, schema, snapshot mode, or source-of-truth behavior changes. Frozen installation preserves the patch without lockfile changes.

A further 48-load comparison against the preload build found no cold-load improvement: normal automatic cold 271 → 270 ms; 4× automatic cold 603 → 611 ms. Slow reload medians improved from 311 → 292 ms (automatic) and 310 → 297 ms (public), while normal reloads were nearly unchanged. Keep the change for removing a verified unused runtime and reducing repeated startup work; do not credit it with a cold-load speedup. Raw synthetic measurements are in `reader-sqlite-runtime-2026-09-14.json`.

24 Chromium checks and 16 WebKit checks passed: the direct runtime-count assertion, bootstrap continuity, unavailable storage in four modes, public/session isolation, lock contention, leader handoff, duplicate tabs, silent workers and recovery deadlines. The Chromium runtime-count check covers cold load and reload; fallback functionality is checked in both browsers.

## Production verification

First release `02afed7f2d5adff1be5079de697a9dcedef8c53f` is pushed to main and READY in deployment `dpl_4bBNCiPtapLg6U8AAzAHFus5sLmo`, aliased to Diana and diagnostics. Existing authenticated Chrome verified the new entry (`index-DjvoDI5Q.js`), Insurance article, reload, sidebar navigation to Home, history back, search palette and Escape, with no captured console errors. Native browser access cannot read the Performance API; no automated production password was available. This confirms functionality, not production load timing.

## Live signed-in bottleneck and access experiment

The opt-in native Chrome measurement exposed an existing profile-dependent issue that clean fixtures missed. On `af32de27`, the signed-in account took 21.9 seconds on the first measured load and 9.7 seconds on reload, with a persisted-store timeout. Earlier releases had already logged the same timeout in this browser profile. Expanded diagnostics in `4188dc21` separated an 8.1-second load into 1.25 seconds of HTML delivery, a 3.08-second identity request, the 3-second persisted-store deadline, and temporary-store rendering. Long main-thread tasks were only about 60–100 ms each; the delay is not explained by one long React render.

Explicit public mode in the same profile took 2.23 seconds, with HTML complete at 367 ms and identity responding in 101 ms. This public run did not need the persisted-store timeout, but remains far above the clean fixture. These are exploratory, opt-in, existing-profile measurements, not isolated benchmark medians. The account's identity path and populated/potentially contended storage need priority over further small bundle changes.

The signed-in cache-key path previously fetched full manifest metadata in batches of 100 and then awaited an access RPC for every batch. The new candidate uses the existing lightweight listPage endpoint in batches of 1000, overlaps the next metadata page, and runs at most four existing access-check batches of 100 concurrently. It computes the same allowed-sensitive-slug list and therefore the same cache key, with no authorization cache or policy changes. If a larger page exceeds the backend read budget, it retries that cursor with the original batch size and keeps that size afterward; persistent failures propagate.

A 2500-document synthetic comparison (2000 sensitive, three alternating samples per mode and latency) reduced 50-ms-RPC medians from about 2.58 seconds to 312 ms, preserving exactly the same allowed results. Metadata calls fell from 25 to 3, access calls from 25 to 20, and access concurrency is bounded at four. All 49 access/API/session unit tests passed, including denied results, revocation, oversized-page fallback, exact list equality and failure propagation. Deployed as `d6ec89173bc805f493fda3f1cb506e88f01e3d28` (`dpl_BZLmgpm36ktCbe3czLxysew57ySo`), READY with production aliases. One warm signed-in identity request improved from 3078 ms on the prior release to 839 ms; total observed startup was still 4307 ms because the three-second storage fallback remained. The first measured request after this deployment took 17 seconds, similar to the earlier release's long first observed load, so cold backend behavior remains unresolved. No session-computation error logs were found for the deployment. Do not present this single warm comparison as a production median.

The existing local timing observer now has an explicit `?paintDebug=1&readerStorage=memory` comparison mode. It uses the same LiveStore schema and validated identity with the existing in-memory adapter for that document only. It neither deletes OPFS data nor changes saved preferences; ordinary routes retain persisted storage. Five Chromium checks and one WebKit check passed (the Chromium-only runtime-count test is skipped in WebKit).

## Continuation

### Follower recovery and bootstrap import

The diagnostic release `fa2b070b82e442ba17ae0586776bd051c99c6f26` is READY (`dpl_4RmFZiDLzDoH29y2u4RPnEK6UALC`) with production aliases. Three native signed-in Chrome memory-mode loads measured 1651, 1455 and 1158 ms. HTML completed at 412, 361 and 349 ms; identity requests took 1013, 1039 and 761 ms. Restoring ordinary persistence measured 4178 ms, with a 731-ms identity request followed by the full three-second store timeout. These are existing-profile exploratory samples, not controlled medians or proof of sub-500-ms startup.

The next candidate queries existing Web Locks before mounting the provider. Only an already held lock matching the exact complete store partition selects a 750-ms follower deadline; new leaders retain 3000 ms. The probe is read-only and bounded at 25 ms, and unsupported/rejected/stalled probes retain the original deadline. Expiration uses the existing temporary LiveStore fallback and releases the abandoned provider without stealing a lock or deleting persistence. Diagnostic phase names distinguish an existing leader from a new one. The seed-page module now downloads while the adapter starts; applying the response still happens only inside the validated store's boot callback.

Seven storage unit tests and all 17 focused Chromium checks passed, including a healthy follower with 4x CPU throttling, leader handoff, rapid reloads, stale worker versions, orphaned lock preservation, identity isolation and article continuity. WebKit passed 14 checks and skipped the Chromium-only runtime-count check. Two persistence-specific WebKit checks failed identically on both candidate and older preload build: OPFS sentinel setup throws UnknownError, and the worker-version case uses unavailable-storage fallback before a persisted timeout. Do not report these two cases as verified in WebKit. Full build/typecheck and changed-file ESLint passed. The follower probe adds about 0.4 KiB eager gzip; the shell chunk allowance was explicitly raised by 512 bytes (total eager budget unchanged), rather than hiding the safety code in another chunk.

Deployed as `4093941e4baad32b47ee70d1a46a07707710a188`, READY in `dpl_9K5ucP9W1d2Ek2tme5FJn5iXf1b8` with production aliases. Native signed-in Chrome confirms an existing leader, then timeout at approximately 752 ms. Three warm loads measured 1857, 2152 and 2091 ms; HTML completed at 360, 352 and 392 ms with server durations of 269, 246 and 280 ms. Identity requests took 692, 996 and 895 ms. Search opened and dismissed successfully and the article remained visible. The first post-deploy identity request still took 17.5 seconds (19.6 seconds total), so the cold-path problem is independent of the follower timeout.

### Function-region comparison and backend diagnostics

The HTML function was deployed to sfo1, iad1 and fra1, while the API already runs in iad1. The next reversible configuration experiment pins HTML to iad1 too, testing whether fewer backend round trips outweigh the longer browser-to-function trip. Do not assume the database region or claim a benefit before measuring. This changes no request handling or authorization logic.

`paintDebug=1` now requests opt-in session Server-Timing groups for metadata, access checks, other RPCs, counts and failures. Only fixed group names and numeric aggregates are exposed; no function arguments, page contents, account identifiers or error text. Ordinary requests are unchanged. 31 client/tracing unit tests, 11 Chromium bootstrap/observer checks, full build/typechecks, ESLint and bundle budgets passed. Convex documentation/source confirms identity-dependent query caching, but there is no evidence yet that service token rotation explains the long cold request; do not change token lifetime or authentication to test this hypothesis.

This comparison is deployed as `8d145eab3da06c80995717a5e8a24617b46e6b54` (`dpl_BNCJ7ahFo8YfDu44Rx9eZbhCLFsv`, READY with production aliases). Two warm loads had HTML end times of 235 and 317 ms, server HTML work 54 and 74 ms, compared with the prior 352–392 ms / 246–280 ms. Keep the iad1 placement for the measured reduction in server work; sample size and network variance still limit a global claim. Total warm startup remained 1884 and 1721 ms.

### Indexed sensitive metadata

The new cold diagnostic located 17.14 seconds in 29 metadata-page RPCs, with no RPC failures. Access checks made seven calls totaling 2.45 seconds, overlapping the metadata scan. The API handler itself took 17.17 seconds, so this delay is inside the backend work, not the function's JavaScript initialization. Warm metadata scans still made 29 calls (462–642 ms summed). The allowed-sensitive-slug computation needlessly reads the site's public documents.

The existing `documents.listPage` query now accepts an optional `sensitiveOnly` selector. It uses the already deployed `by_site_sensitive_slug` index with `sensitive === true` before pagination; existing visibility, deletion and tenant checks still apply. Ordinary callers are unchanged and legacy sites without a site ID retain the existing filtered scan. Tests compare the indexed output against the old filtered full scan, verify tombstones/tenant isolation/service authentication, and prove that pagination skips a large public prefix. No schema or index migration is needed. The query was committed/pushed as `7e6611ce78d3a8b0f625c743fcbd61ab2e7e3549` and deployed successfully to the existing production Convex backend before changing the API caller. Dry-run auth/index diffs were empty; an empty Node-version warning came from the CLI comparing null with undefined, with no explicit version on either side.

The API caller now selects sensitive-only metadata and retains the same bounded access checks, fallback batch sizes and cache-key calculation. Seven backend/access tests, 51 API/session/backend tests, full build/typechecks and changed-file ESLint passed. A fresh React Doctor check found no issues (the commit hook's advisory did not reproduce). The caller is deployed as `23d04cfe`. Its first measured identity request was 978 ms, with one metadata call (373 ms), four access calls (873 ms summed and overlapping), and no failures; handler duration was 823 ms, compared with the previous 17.17 seconds. Two warm requests were 361 and 245 ms, with backend durations 238 and 115 ms. Metadata remained one call and access four calls, with zero failures. Remaining cold variance is real: a later memory-mode diagnostic took 1005 ms for identity, including 383 ms metadata and 936 ms summed access work. This motivates eliminating the duplicate document reads rather than relying on backend cache warmth.

Module preloads and deferred fallback SQLite are deployed as `af32de27f055c57ceeed61a47ceec644d375db19` (`dpl_41ZNGS9pcjVpEXX5nNDTu2RUoZpR`). Expanded opt-in timing diagnostics are deployed as `4188dc21cdceea18a6f759ddb94c5aca6427695c` (`dpl_7JGyoNjctqCDwcZ3zVXqWHZYVws2`). Both are READY with production aliases; the browser shows `index-DEJ05vr9.js` for the latter. Prioritize validating the access RPC optimization and diagnosing the real profile's persisted-store delay. Do not report the sub-500-ms fixture as the user's actual signed-in load time.

Next priority: measure the follower recovery in the actual signed-in profile, then reduce the remaining live identity and HTML latency. Keep authorization decisions fresh; avoid a broad permission-fingerprint redesign solely to improve a benchmark.

This report is a live checkpoint. The heartbeat is `diana-overnight-startup-optimization`, hourly for eight runs, with a stop boundary of September 14 at 08:00 America/Los_Angeles. Worktree: `/Users/jasonlaster/.codex/worktrees/reader-bootstrap-cache/oncobase`. Preserve the dirty primary checkout. Do not claim the target based on a spinner, HTML response time, or one minimum sample.

### Combined sensitive-page authorization

The next query evaluates sensitive index rows with the existing batch access predicate in one transaction, returning only allowed slugs. This removes the second document lookup per slug and repeated role-permission reads. It preserves fresh authorization and the existing cache-key computation. The backend query was pushed and deployed as `45650fbe` before adopting it in the API. The API retains sequential pagination with a same-cursor retry from 1000 to 100 rows on failure.

Backend tests compare the previous metadata-plus-access pipeline with the new query and exercise explicit and email-derived grants, revocation, path/tag inclusion and exclusion, legacy rule aliases, tenant isolation, malformed foreign references, tombstones, pagination and service authentication. Five backend tests (1083 assertions), 55 API/session/tracing tests, full build/typechecks and changed-file ESLint passed. The final standard Convex dry-run showed no schema/index/auth changes. No verbose deployment output was used.

Immediately before adopting the query, native signed-in Chrome measured 2250 ms for the first load and 1331 ms for a warm reload. Identity took 1048 and 200 ms respectively; each made one metadata and four access calls. Both hit the existing-leader 750-ms fallback. These are exploratory same-profile comparisons, not population medians. The combined-query production result is still pending.

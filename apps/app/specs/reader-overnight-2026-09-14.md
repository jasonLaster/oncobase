# Overnight reader startup work — September 14, 2026

Target: initial usable reader below 500 ms while preserving client-side React, LiveStore, access isolation, and article continuity. Baseline production commit: `050c1ac3`.

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

A 2500-document synthetic comparison (2000 sensitive, three alternating samples per mode and latency) reduced 50-ms-RPC medians from about 2.58 seconds to 312 ms, preserving exactly the same allowed results. Metadata calls fell from 25 to 3, access calls from 25 to 20, and access concurrency is bounded at four. All 49 access/API/session unit tests passed, including denied results, revocation, oversized-page fallback, exact list equality and failure propagation. This has not yet established the production improvement.

## Continuation

Module preloads and deferred fallback SQLite are deployed as `af32de27f055c57ceeed61a47ceec644d375db19` (`dpl_41ZNGS9pcjVpEXX5nNDTu2RUoZpR`). Expanded opt-in timing diagnostics are deployed as `4188dc21cdceea18a6f759ddb94c5aca6427695c` (`dpl_7JGyoNjctqCDwcZ3zVXqWHZYVws2`). Both are READY with production aliases; the browser shows `index-DEJ05vr9.js` for the latter. Prioritize validating the access RPC optimization and diagnosing the real profile's persisted-store delay. Do not report the sub-500-ms fixture as the user's actual signed-in load time.

Next candidate after that: start the existing seed-page dynamic import when the reader boot callback is created, overlapping its download with database boot. Currently it starts only after the database is ready. Do not consume or apply the payload early.

This report is a live checkpoint. The heartbeat is `diana-overnight-startup-optimization`, hourly for eight runs, with a stop boundary of September 14 at 08:00 America/Los_Angeles. Worktree: `/Users/jasonlaster/.codex/worktrees/reader-bootstrap-cache/oncobase`. Preserve the dirty primary checkout. Do not claim the target based on a spinner, HTML response time, or one minimum sample.

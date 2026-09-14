# Next CSR startup optimizations

Exploration against deployed source commit `c6cb9c9896bed53a47ca76fb240a4d7c7208d0eb`. All timings below are new local measurements, not production timings. Experimental application edits were restored after profiling; nothing was pushed or deployed in this exploration.

## Recommendation

First remove the two avoidable startup Suspense waits and stabilize the LiveStore boot callback. This smaller change reached 140 ms median article readiness on an explicitly public, cached reload at normal CPU. Then separate article rendering from identity and database startup to address cold loads, automatic scope selection, and slower devices. Keep the current React article mounted as data sources become available.

## Measurements

96 loads across four variants, two CPU settings, public/automatic scope, and cold/reload visits. Each cell is the median of three fresh browser contexts; each context performs a cold visit followed by a reload. The variants ran sequentially, not randomized. The benchmark uses a small synthetic article, real loopback HTTP with gzip, no request interception, and the existing bootstrap fixture: identity 200 ms per request, manifest 400 ms, body 350 ms. Automatic scope deliberately has no signed-in account: a session 401 precedes the public identity request. These are not account-session benchmarks.

The timer starts at navigation and ends on a frame after visible React markdown appears. It does not establish full file-tree/search readiness, long-document performance, physical-device behavior, browser-restart code caching, or production percentiles. HTML arrives in milliseconds here; real document response latency is additional. Each variant uses a browser process with separate contexts, so cold means a fresh context, not a rebooted machine/browser for every sample.

| CPU | Scope | Visit | Current | Outer boundary removed | Both waits removed | Both + stable boot |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1x | Public | Cold | 1,101 | 776 | 469 | 475 |
| 1x | Public | Reload | 410 | 309 | 142 | 140 |
| 1x | Automatic | Cold | 1,298 | 983 | 691 | 687 |
| 1x | Automatic | Reload | 1,114 | 820 | 529 | 532 |
| 4x | Public | Cold | 1,394 | 1,014 | 717 | 698 |
| 4x | Public | Reload | 504 | 411 | 3,274 | 312 |
| 4x | Automatic | Cold | 1,548 | 1,223 | 889 | 891 |
| 4x | Automatic | Reload | 1,236 | 916 | 605 | 604 |

All values are milliseconds. All 96 loads had zero uncaught page errors and zero page-body requests. The unstable intermediate variant demonstrates why the smallest timing alone is insufficient: earlier rendering exposed a restart race. The final 24-load variant had exactly one adapter startup per load and no frame-observed disappearance during the roughly 900 ms observation period after initial readiness. This short window is not a full navigation or long-term stability test.

## 1. Remove unnecessary startup Suspense boundaries

`main.tsx` lazily loads `WikiViteRoot`, which starts identity resolution in an effect. In the current normal-CPU cold public case, that effect starts at a median 323 ms although the root module has already downloaded. Identity completes around 549 ms, but the adapter starts around 855 ms: another roughly 300 ms wait. The adapter ends around 1,055 ms, bootstrap seeding occurs around 1,063 ms, and the article appears around 1,101 ms. These are separate milestone medians, not an additive decomposition.

The installed React production code contains the 300 ms fallback throttle. React's [Suspense documentation](https://react.dev/reference/react/Suspense#caveats) also describes throttled reveals. The experiment imports the small `WikiViteRoot` synchronously, then explicitly tracks resolution of the existing dynamic LiveStore module import and renders it when available. Database code remains dynamically loaded, overlapping identity verification. It does not alter React internals, disable StrictMode, remove specialist route splits, or bypass identity checks.

The entry's changed dependency graph, login/specialist-route behavior, load-error recovery and bundle-cache stability still need release validation. The saved experiment is a performance probe, not a release-ready patch.

## 2. Keep the boot callback stable within a store

`ReaderStore` currently memoizes `createReaderBoot(identity)` on the identity object's reference. A successful public identity refresh supplies a new object even when the store partition is unchanged. The installed LiveStore provider treats a new boot function as an input change and interrupts/recreates its store.

Current public reloads recorded two adapter startups. Removing the startup waits without fixing this produced a 3,274 ms slower-CPU reload median, including repeated starts and timeout recovery. The final experiment creates the boot callback once for the already keyed `ReaderStore`. A changed store ID still remounts that component, preserving site/scope/access partition changes. Final samples had one startup each. Verify changed identity/access keys, revoked content, denied OPFS, simultaneous tabs and failure recovery before release.

## 3. Render the response page before identity and LiveStore

Even after the small fixes, the normal-CPU cold public case takes 475 ms with an imposed 200 ms identity response; the slower-CPU reload takes 312 ms. The next architectural change should validate the existing public page payload outside LiveStore and feed it directly to a shared React document component. Start account resolution and persistence independently, and connect live updates afterward.

Extract the presentation in `WikiPage.tsx` from its database queries. Keep one mounted article and stable content props; attach a LiveStore-backed data connector without replacing the article or resetting selection, scroll, tables or image state. React props/context may be enough initially; [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) is an option for a mutable external snapshot. The existing page validator/consumer must be separated so early reading does not consume the payload before database seeding.

Only the same-response, validated public payload can take this shortcut. Explicit session-only pages and pages with no acceptable payload retain the authorized path. The payload cannot select an account or authorize cached private content. Route changes, changed revisions and manifest revocations must invalidate/update the initial snapshot rather than leave an independent stale copy. Sidebar tree and search need their own readiness measurements: the current normal response bootstraps the page, not an entire navigation manifest.

## 4. Resolve automatic scope without two serial requests

`resolveReaderSession` currently requests session identity, then public identity on a 401. The synthetic automatic cases therefore impose two 200 ms waits, even on reload. Consider a server endpoint that returns the validated effective identity in one response, or verified response-scoped identity metadata where already available without adding an HTML-blocking backend call. Do not simply force public scope: account navigation and access-specific cache keys must remain correct. Rendering a permitted response page independently makes this identity choice background work for that page.

## 5. Reduce the first-render asset graph

The current build has 1,198.5 KiB gzip of startup assets, including JavaScript, workers, WASM and CSS. Effect (119.4), LiveStore (100.2), its worker (161.6), shared worker (112.9) and SQLite WASM (294.6) total about 789 KiB. Deferring that group could remove roughly two-thirds of the current startup bytes; this is an inventory opportunity, not a measured resulting bundle. Background loading must also avoid competing with first paint on slow CPUs.

The markdown vendor is another 183.7 KiB. `wiki-markdown/src/math.ts` imports KaTeX for every document; the main renderer also imports slide, image-theater and smart-table behavior. Profile feature-based splits after the database boundary is removed. Preserve plain table/image rendering and markdown semantics, including currency, math, raw HTML and wiki links. Existing stable vendor ownership must survive these changes. Diagram and specialist route code is already lazy, so indiscriminate additional splitting is unlikely to help.

## Evidence and next gate

The adjacent JSON stores all 96 compact samples and medians. Detailed resources and the profiler are under `.playwright/reader-next/`; `stable-startup.patch` preserves the three-file experimental diff. The synthetic server is `PROFILE_SERVE=1 PROFILE_PORT=62173 bun apps/app/scripts/profile-bootstrap-cache.ts`, followed by `bun .playwright/reader-next/profile.ts` against the chosen production build. Stop the fixture before replacing a build. The original source and build were restored after collecting the variants.

Before adopting the small patch, run the focused CSR/bootstrap and identity/recovery browser tests in Chromium and WebKit, verify first-frame-to-stable-content behavior across refresh and navigation, and repeat the vendor-cache check. The architectural experiment should additionally hold identity/database startup unresolved and prove the authorized React article remains readable and navigable. A 200 ms result must specify cache state, CPU, network, scope, document size and whether it measures article or full navigation readiness.

## Implementation follow-up

The first implementation adopts the startup module changes and a stable, store-partition-local boot callback. Module loading uses an explicit loading/ready/error state; identity failures still show their recovery screen independently. The database remains dynamically loaded and account/store authorization is unchanged. It incorporates `5a0bab0c` (note-bundle navigation) before release.

The entry budget now includes the previously separate identity boundary and its shared helpers: its limit is 24,000 gzip bytes. The aggregate startup limit is unchanged; the measured build is about 1,197.8 KiB gzip. All five vendor chunks survive the cache-stability probe unchanged, with no application imports.

The new browser regression test holds the refreshed public identity response until the cached article is visible, releases it, and checks the original article node and single adapter startup across 75 frames. It then navigates away/back and opens search. It passes in Chromium at 4x CPU slowdown and in WebKit. Focused unit tests, TypeScript, changed-file ESLint, React Doctor, bundle budgets and whitespace checks pass. Chromium's seven storage-startup scenarios also pass, including locked storage, multiple tabs, version handoff and timeout recovery.

Two test harness races were corrected: the stale-chunk test now waits for the preload-triggered replacement document before clicking search, and login tests wait for destination DOM readiness before the next navigation. The stalled-JSON-body fixture now forwards the request directly to its streaming server, since WebKit rejects intercepted 307 fulfillment. Its timeout behavior passes in both engines.

Known verification limitation: WebKit intermittently retains a failed module result after the test deliberately aborts a lazy JavaScript download. It reaches the existing visible reload recovery screen instead of opening search. The same strict test failed against the saved pre-change build in one of three repeated runs (two passed). A zero-delay and a 300 ms delayed-reload workaround were tested but neither eliminated the issue consistently; both were removed. Production load-error handling is therefore unchanged. Normal bootstrap, identity isolation/rotation, denied-session recovery and the new continuity test pass. The final targeted coverage comprises 22 Chromium cases and 14 WebKit cases passing across focused runs, with this one strict WebKit recovery scenario still intermittent. This does not establish a production 200 ms guarantee.

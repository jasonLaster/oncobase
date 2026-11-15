# Oncobase improvement proposal (2026-11-13)

Status: proposal, nothing implemented. Scope: `apps/app` (reader, server, Convex), the shared packages, and `apps/oncoguide` where it shares code. Dimensions: performance (weighted highest), architecture and software quality, accessibility, design consistency.

## 1. Summary

The reader is fast when it is warm and on a good connection, and slow in the case that matters most for this product: a first visit, or a visit after a deploy, on a phone with a poor connection. The codebase is type-safe and well tested at the unit level, but the reader's startup logic, its overlays and its styling have each grown several parallel implementations, which is what makes the performance and accessibility problems expensive to fix.

Five findings drive most of the proposal:

1. **A cold load on a slow phone shows a blank page for about 7 seconds.** In the lab (slow 4G, 4× CPU slowdown) the article appears at 7.3 s; the 4 KB article body is not even requested until 7.0 s, because the request sits behind 867 KB of JavaScript, 295 KB of WebAssembly and the local database boot. Real users confirm the tail: LCP is 1.0 s at p50 but 3.9 s at p90 and 6.3 s at p95.
2. **Production dashboards describe CI, not people.** 96% of browser boots in the last 30 days (10,095 of 10,534) came from end-to-end test runs against production. With those removed, real-user LCP p75 is 1.7 s, not 0.7 s.
3. **Manifest revalidation is the largest server cost and it is mostly waste.** Every open signed-in tab polls every 30 s, forever. Vercel strips `If-None-Match` before the function runs, so each poll re-derives the whole manifest with about 11 Convex queries (185 ms), then the edge turns the 200 into a 304. That is 89k such requests in 30 days against about a hundred publish runs.
4. **Keyboard and screen-reader users cannot use the reader efficiently.** There is no skip link, and 70 Tab presses do not reach the article. A route change moves neither focus nor announces anything. Expanding a table throws focus to `<body>`. The status region announces "Checking…" every 30 s.
5. **The UI is one brand rendered through many systems.** Measured across 23 surfaces: 15 different `h1` styles, 17 button heights, 44 font sizes. One page (`/tags/:tag`) renders with no layout at all.

Proposed targets:

| Metric | Now | Target |
| --- | ---: | ---: |
| Lab cold load, slow 4G + 4× CPU: time to article | 7.3 s | ≤ 2.5 s after phase 1, ≤ 1.2 s with server rendering |
| Real-user LCP p75 / p95 | 1.7 s / 6.3 s | ≤ 1.2 s / ≤ 2.5 s |
| JavaScript + wasm downloaded before the article paints | 1,162 KB | ≤ 300 KB |
| Landing page LCP, slow 4G | 5.7 s | ≤ 2.5 s |
| Origin time for a "nothing changed" manifest check | 185 ms, ~11 Convex queries | ≤ 40 ms, ≤ 1 query; none while the tab is hidden |
| Navigation to a large page (279 KB markdown), 4× CPU: longest task | 585 ms | ≤ 200 ms |
| Tab presses to reach the article | more than 70 | ≤ 2 |
| Overlays missing a focus trap, Escape handling or focus return | 6 of 14 | 0 |
| Distinct page-title styles in the app | 15 | 2 (app page, marketing hero) |

## 2. How this was measured

- **Production traces.** Axiom `oncobase-traces`, 7-day and 30-day windows, via `apps/app/scripts/query-traces.ts` plus ad-hoc queries. "Real user" means hours with fewer than 20 browser boots; the 13 burst hours are CI runs.
- **Production probes.** Read-only `curl` requests against `diana-tnbc.com` and `oncobase.io` for timing and headers, and `vercel logs` for 404 paths.
- **Local lab.** An isolated local stack (self-hosted Convex, standalone server) on its own ports, with a synthetic 2,323-page vault (24 MB, nested folders, 350 access-restricted pages, nine 279 KB pages with 30 tables each) published through the real publisher. A gzip proxy sat in front of the standalone server so transfer sizes resemble production. Playwright drove Chromium; numbers are medians of three runs.
  - "Desktop": 1440×900, no throttling.
  - "Mobile": 390×844, 4× CPU slowdown, 1.6 Mbps down, 150 ms round trip (Lighthouse's slow 4G).
- **Accessibility and design.** axe-core (WCAG 2.0–2.2 A/AA plus best practices, all impact levels) on 23 surfaces in light, dark and mobile variants (49 runs), scripted keyboard walks, and computed-style sampling. Five read-only code audits supplied file-level evidence.

Caveats:

- The lab server is on loopback, so server time and latency are near zero on desktop; the mobile profile adds network cost but not production server time. Lab numbers are best read as relative.
- Real-user sample sizes are small (238 LCP samples, 70 INP samples in 30 days).
- Claims marked *(code)* come from reading the source and were not exercised in a browser.
- The harness and raw results live in the session scratchpad, not the repo. Landing a cleaned-up harness is item M1.

## 3. Scorecard

| Area | State | Evidence |
| --- | --- | --- |
| Warm load | Good | Lab: article at 119 ms desktop, 572 ms mobile. 8 KB transferred. |
| Cold load, fast connection | Good | Lab desktop: article at 276–322 ms, 1.3 MB transferred in 67 requests. |
| Cold load, slow connection | Poor | Lab mobile: article 7.3 s, tree 7.6 s; large page 9.0 s with 1.3 s blocking time. |
| Real-user loads | Mixed | LCP p50 976 ms, p75 1,698 ms, p90 3,903 ms, p95 6,269 ms. 19% of loads exceed 2.5 s. Reader-ready p90 is 9.5 s. |
| In-app navigation | Good, except large pages | 40–58 ms for a 10 KB page; 293 ms (1,062 ms at 4× CPU) for a 279 KB page, repeated on every revisit. |
| File tree interaction | Good | Expand 22–53 ms (32–69 ms at 4× CPU); virtualizes above 150 rows; scroll frames p95 10 ms. |
| Server | Mixed | Page bodies p50 53 ms. Manifest: 162k requests in 30 days, session scope p50 185 ms, cold start p50 995 ms, 232 requests over 2 s. |
| Accessibility, public pages | Good | Zero axe violations on landing, sign-in, education and marketing home; skip links present. |
| Accessibility, reader | Poor for keyboard and screen readers | Section 6. |
| Design consistency | Fragmented | Section 7. |
| Type safety, unit tests | Good | `strict` everywhere, no `any` in client code, 78 unit test files in app and server. |
| Lint and CI coverage | Gaps | Packages (42k lines) are never linted; some unit tests never run in CI. |

## 4. Performance

### 4.1 Cold load: content waits behind everything else

**Evidence (lab, mobile profile, signed-in user, no local cache):**

| Time | What happens |
| ---: | --- |
| 0.19 s | HTML arrives (6 KB). An inline script adds 38 equal-priority `modulepreload` links. |
| 1.5 s | The single stylesheet (61 KB) finishes. |
| 3.6 s | `vendor-react` (58 KB) finishes, last of the entry graph, having competed with `vendor-effect` (120 KB) and `vendor-livestore` (100 KB), which the first paint does not need. The entry script can now run. |
| 3.7 s | `/api/wiki/session` is requested. |
| 3.8 s | The SQLite wasm (295 KB) and two worker scripts (275 KB) start downloading. |
| 5.0 s | The screen is still white apart from an "Opening reader…" pill. |
| 6.9 s | The local database is ready. |
| 7.0 s | The manifest and the article body are requested. The skeleton appears. |
| 7.3 s | The article paints. The tree follows at 7.6 s. |

- The same chain shows in production: for real users, `store-boot-complete` is 1.1 s at p50 and 4.7 s at p90, and `reader-ready` is 9.5 s at p90.
- A cached localStorage snapshot hides the chain on repeat visits (572 ms), which is why the median looks healthy. The snapshot is cleared on sign-in pages and is absent on a new device.
- The landing page pays for the reader too: `/` is not on the preload skip list (`apps/app/scripts/reader-preload-plugin.ts:8-11`), so a signed-out visitor downloads 595 KB of JavaScript in 53 files. Lab mobile LCP is 5.7 s.

**Proposal:**

- **P1. Request content first.** *(M, low risk)*
  - Start the session, manifest and current-page requests from an inline script in the document head, in parallel with the JavaScript download, and hand the promises to the reader. Today `App.tsx:155` mounts the sync component only once a store exists.
  - Extend the server's inlined page payload (`server/page-bootstrap.ts`, public scope only today) to gated and signed-in documents. The shell function already authenticates the request and already answers `private, no-store`.
  - Render the article through the existing early-reader path (the app can render outside the LiveStore provider, `LiveStoreRoot.tsx:366-377`) as soon as React and the markdown renderer are ready. The store attaches afterwards through the existing handoff.
- **P2. Split the boot graph by purpose and prioritize it.** *(M, low risk)*
  - Paint-critical: React, shell, markdown renderer, about 410 KB including CSS. Store: Effect, LiveStore, workers, wasm, about 800 KB.
  - Remove the accidental edge that puts the store in the first chunk: `apps/app/src/wiki-utils.ts:2` imports `events` from the LiveStore schema just to reach slug helpers.
  - Preload the paint-critical set at high priority and the store set at low priority. Start the wasm and worker downloads from the head script rather than after `LiveStoreRoot` evaluates (`LiveStoreRoot.tsx:125-148`); the wasm is never preloaded today.
  - Take `/` and other non-reader documents off the preload path using the server's own routing decision rather than a hard-coded path list.
  - Expected effect of P1 + P2, from the byte counts: article at roughly 2.5 s on the mobile profile.
- **P3. Render the shell and article on the server, then hydrate.** *(L, medium risk — the ambitious step)*
  - Stream HTML for the page chrome, the navigation slice (top level plus the current page's ancestors) and the article, produced by the same React components from the same payload the client hydrates with.
  - This is different from the September HTML-first experiment, which was withdrawn because saved HTML and cloned controls had to be swapped for the live reader (`specs/client-rendered-reader-2026-09-11.md`). Hydrating one tree has no handoff. That experiment still measured the prize: article at 318 ms instead of 1,416 ms.
  - `apps/oncoguide` already renders `wiki-markdown` and parts of `wiki-shell` on the server, so the packages are close to server-safe.
  - Costs to plan for: the shell function has a 256 KiB bundle budget (`scripts/reader-server-budget.ts:38`) that server rendering will exceed, and its cold start (p50 89 ms) will grow.
  - Expected effect: article at about 1 s on the mobile profile, independent of JavaScript size.
- **P4. Stop shipping one stylesheet for every route.** *(M, medium risk)* `cssCodeSplit: false` (`vite.config.ts:97`) means the reader ships about 4,400 lines of marketing and education CSS and 73 KB (raw) of Liveblocks CSS on first load, and marketing ships the reader's. Split by surface (reader, marketing, education, viewers) with explicit `<link>` tags, which keeps the reason for the current setting (no CSS preload failures).
- **P5. Give the tree its own small first payload.** *(M)* The tree waits for the full manifest (57 KB gzipped for 2,000 pages in the lab; 40 KB for the 616 public pages in production). Inline the navigation slice with the document (P1/P3) and load the rest after paint. Longer term, serve manifest deltas keyed by revision instead of whole snapshots.

### 4.2 Manifest revalidation: the largest server cost

**Evidence:**

- `/api/wiki/manifest` took 162,381 requests in 30 days; no other route exceeds 15k. 88,756 were signed-in ("session") requests at p50 185 ms.
- Each session request runs about 11 Convex queries. In 7 days: `listPdfAssetVisibilityPage` 100,756 calls, `manifestCache:current` 86,857, `filterAccessibleSlugs` 68,604, `listAllowedSensitiveManifestPage` 67,125, `getSessionUser` 37,199. The "cached" strategy still runs every read, because the cache key is a hash of the freshly read data (`packages/wiki-content/src/server.ts:977-979`) *(code)*.
- Arrivals were flat at about 4 per minute around the clock from Nov 6 to Nov 11, then fell to 8 per day: a couple of tabs left open. `WikiSync.tsx:54-57, 291-298` re-arms a 30 s timer (60 s public) with no visibility check and no backoff.
- The lab confirms the poll: a validation with `If-None-Match` every 30 s, a 304, a telemetry POST, and a status-region flip.
- **The validator never reaches the function.** I sent three conditional requests to production; each returned 304 to me and was recorded at the origin as an unconditional 200 (`http.request.conditional=false`, `manifest.validator=absent`). The platform strips the header, runs the function in full, and converts the response. This explains the "zero 304s" puzzle in the October audit, and it means the server's validator branch is dead in production.
- Uncached paths are slow: a manifest request without a cached copy has a server p50 of 517 ms; the live fallback is 3.5 s; cold start is 995 ms; ten requests in 30 days died at the 15 s timeout.

**Proposal:**

- **P6. A cheap "has anything changed" answer.** *(M, medium risk)*
  - Send the known state as a query parameter (`?known=<token>`) and return 204 before any derivation when it matches. Build the token from user id, `manifestRevision`, snapshot hash and a new `accessRevision`. The gate's `sites:getBySlug` already returns the first two.
  - `accessRevision` is required because role changes do not bump the manifest revision today (`convex/access.ts:391-612`) *(code)*. A missed invalidation would hide an access change, so keep the full path while a scoped publish is active and cover this with contract tests.
  - For real changes, replace the two parallel chains with one Convex query that returns allowed sensitive pages, sensitive assets and the revision fence in one transaction.
- **P7. Poll like a guest, not a daemon.** *(S, low risk)* Validate only while the tab is visible; revalidate on focus, reconnect and navigation; back off towards five minutes while nothing changes; and do not flip the visible status or the live region for background checks.
- **P8. Push instead of poll.** *(M, later)* Signed-in tabs already mint a Convex token for chat. A subscription to the site's revision removes polling entirely. Do this after P6 and P7 have removed the cost pressure.
- **P9. Make the gate cheap.** *(S)* `api.gate` runs a Convex read on almost every API request (54,697 in 7 days, p50 34 ms). The host cache misses 30% of the time (58k hits, 25k misses) because it has a 15 s TTL and stores values rather than in-flight promises, so a burst of parallel requests all miss (`server/reader-access.ts:99-126`) *(code)*. Use one slim `sites.gate` query, single-flight it, and cache gate config for 10 s. `sites:getBySlug` currently returns the whole row, including token hashes *(code)*.
- **P10. Survive cold starts.** *(S)* Persist the derived, compressed manifest by hash (Vercel Runtime Cache or beside the snapshot in Blob) so a new instance does not rebuild it.

### 4.3 Private content is never cached by the browser

- On the gated site every API response is rewritten to `private, no-store` (`server/api/gate.ts:96-110`) *(code; confirmed on the production manifest)*.
- Images and PDFs go through `/api/file`: 11,658 requests in 30 days, p50 94 ms, each proxying Blob through a function, with no ETag forwarded.
- Page bodies are refetched on revisit unless fetched in the last 30 s (`WikiSync.tsx:163-171`) *(code)*: real-user `request-pages` is 200 ms at p50 across 4,685 requests.

**Proposal:**

- **P11. Content-addressed private URLs.** *(M, low–medium risk)* Put the content hash the manifest already carries into file and page URLs (`?v=<contentHash>`) and serve them `private, max-age=31536000, immutable`. Skip the page request entirely when the stored hash matches the manifest. This also closes the open "stale page after publish" item from the October audit. Decide deliberately how sign-out treats the private HTTP cache.

### 4.4 Navigation and rendering

- Ordinary navigation is fast: 40–58 ms for a 10 KB page, 33 ms cached.
- A 279 KB page with 30 tables takes 293 ms (1,062 ms at 4× CPU, with a single 585 ms task) on every visit including cached revisits, and leaving it takes 215 ms (681 ms). It produces 10,800 DOM nodes.
- Causes *(code)*: `navigate(href, { flushSync: true })` renders the destination synchronously (`shell/Navigation.tsx:417`); the markdown is re-parsed on every visit because parsed output is not cached across pages (`packages/wiki-markdown/src/renderer.tsx:234-325`); every table is enhanced eagerly.
- Real users: route render p50 185 ms, p95 348 ms; INP p75 88 ms, p95 304 ms.

**Proposal:**

- **P12. Parse once.** *(M)* Cache the parsed tree by content hash in memory, and consider producing it at publish time so no client parses large documents at all.
- **P13. Paint intent first.** *(S)* Mark the clicked row and title immediately and render the article in a transition instead of a synchronous flush.
- **P14. Render long articles progressively.** *(M)* Apply `content-visibility: auto` to sections and enhance tables when they approach the viewport.
- **P15. Reveal the active row.** *(S)* On a deep link the active tree row is in the DOM but off-screen (lab: `inDom: true, visible: false`); with virtualization it may not be rendered at all.
- **P16. Remove duplicated tree work at boot.** *(S)* `transformFileTreeForSidebar` runs in the startup cache and again in the LiveStore query (`reader-startup-cache.ts:105`, `livestore/queries.ts:34-50`) *(code)*.

### 4.5 Local database boot

- LiveStore boot is the longest client phase for real users (p50 1.1 s; the "leader" path, used when there is no local state, is 4.0 s at p75).
- The signed-in store is keyed on a hash of the user's allowed page set (`packages/wiki-content/src/server.ts:818-832`). Any access change, or a failed access query (which hashes an empty list), creates a new empty store and refetches everything; old directories are not deleted in session scope *(code)*.
- A second tab gets 750 ms to join before falling back to an empty in-memory store that downloads and polls independently (`livestore/reader-storage.ts:2-3`) *(code)*.
- The 3 s leader deadline sits at the edge on slow links: the lab's wasm and worker download alone took 3.06 s. It did not trip, but it deserves a test.

**Proposal:**

- **P17. Key the store on the user and a revocation epoch** that changes only when access shrinks, and delete retired session directories. *(M, needs a privacy review)*
- **P18. Start deadlines after the downloads complete,** and record why a boot fell back (the `storage-ready` mode is dropped today) so the memory path can be explained. *(S)*
- With P1–P3 in place the store stops being on the critical path, which makes these reliability items rather than speed items.

### 4.6 Public and marketing pages

- Every non-file path invokes a function, including the three static marketing pages (`max-age=0, must-revalidate`, TTFB 140–260 ms from my location).
- Landing illustrations are 1536×1024 WebP files of 0.9–1.2 MB each (ten files, 14 MB in the directory). The sign-in dialog's cartoon is a 900×900 PNG of 1.1 MB. None has a hashed name, so all revalidate on every visit.
- 79% of shell invocations are 404s (20,278 of 25,635 in 7 days). Today's sample is credential-file probes on `www.diana-tnbc.com` (`/.env`, `/.claude/settings.json`, `/.docker/config.json`), WordPress probes on `oncobase.io`, and missing `/favicon.ico`, `/apple-touch-icon.png` and `/sitemap.xml`. For weeks before Nov 12 something also requested a missing path exactly once a minute (about 1,400 per day); traces do not record the path, so I could not identify it.
- A 404 under `/assets/` is served with `Cache-Control: public, max-age=31536000, immutable` (confirmed in production). A browser that asks for a chunk that is missing caches that failure for a year.
- Six production deploys landed in seven days. Open tabs recover from missing lazy chunks by reloading once.

**Proposal:**

- **P19. Prerender marketing and landing documents** and serve them from the CDN. *(M)*
- **P20. An image pipeline.** *(S)* Re-encode illustrations to AVIF/WebP at two or three widths (target about 100 KB), add dimensions and `srcset`, and emit hashed, immutable files.
- **P21. Tidy the edge.** *(S)* Add the missing icons and a sitemap, block dot-file and `wp-*` probes with a firewall rule, and send `no-store` on 404s.
- **P22. Version skew.** *(S)* Turn on skew protection, or keep the previous build's chunks available, so a deploy does not break lazy routes in open tabs.

### 4.7 Publishing

- `/api/publish/begin` took 15.3 s at p50 (21 runs in 30 days; 19 over 2 s).
- Each document costs one HTTP request and two mutations, `documents:upsert` then `documents:upsertEmbedding`, about 75 ms each; the second rewrites the full row and its indexes (`server/publish-api.ts:778-803`) *(code)*.

**Proposal:**

- **P23. One mutation per document and a batch endpoint;** profile `begin`. *(M, protocol version bump)*

### 4.8 Measurement truth

- **M1. Land the lab harness** (cold and warm loads on both profiles, interaction latency, polling observation) under `apps/app/scripts/` and gate CI on three numbers: time to article on the mobile profile, bytes before first article paint, and longest task on large-page navigation. *(S)*
- **M2. Label synthetic traffic.** Tag spans from automation and stop running the deployed suite against production, or exclude it by default in `--report`. Add device class, connection type, viewport class, route type and cache state (snapshot, OPFS, HTTP) to browser spans. *(S)*
- **M3. Fix the blind spots.** *(S)*
  - Telemetry stops after 256 spans per page (`reader-telemetry.ts:44`), so long-lived tabs — the ones doing the polling — go silent after about 43 minutes.
  - The report's "Convex RPCs by request route" table joins on trace id and multiplies counts for publishes: it shows 440,874 `documents:upsert` calls where there were 1,182. Stamp the route on Convex spans instead.
  - Record a shell outcome (document, redirect, asset miss, probe) and a coarse path class on shell spans.
  - The server's `manifest.validator` attribute can never be anything but `absent` in production; replace it once P6 lands.

## 5. Architecture and software quality

Ordered by how much each one blocks the rest of this proposal.

- **A1. Make reader startup one explicit state machine.** *(L, high risk; do it in steps)*
  - Today the logic is spread over `WikiViteRoot.tsx` (7 `useState`), `LiveStoreRoot.tsx` (14) and `sync/WikiSync.tsx`, a 500-line component with 9 effects, 7 refs and two counters that exist only to re-run effects.
  - Components talk through 11 `window` CustomEvent types with 24 dispatch sites; one event is declared twice.
  - Five persisted layers sit in front of the network (inlined payload, localStorage snapshot, first-frame snapshot, OPFS fast-path image, LiveStore), each with its own versioning and retirement code.
  - Steps: move sync into a plain TypeScript controller exposed through `useSyncExternalStore` (unit-testable, replaces the tick counters and four events); add one typed bus for what remains; write the cache layers down in one table; retire the snapshot layers that server rendering (P3) makes redundant.
- **A2. Make lint and CI cover the whole repo.** *(M, low risk)*
  - Only the two apps have a `lint` script, so nine packages (about 42k lines) are never linted. `exhaustive-deps` and `set-state-in-effect` only warn.
  - The hand-written unit list in the root `package.json` omits `packages/wiki-comments`; CI runs two of five `packages/education` test files and names one that does not exist (`.github/workflows/oncoguide.yml:31`).
  - End-to-end code (about 8.8k lines) is not typechecked, and no Playwright config sets `forbidOnly`.
  - Change: one root flat ESLint config (hook rules as errors, `no-floating-promises`, `jsx-a11y`, import boundaries, restricted storage globals), `turbo run test:unit typecheck` instead of hand lists, a tsconfig for e2e.
- **A3. Make deploys safe by construction.** *(M)*
  - `convex deploy` runs before the app build inside the Vercel build (`scripts/build-vercel.ts:39-52`), so a failed build or budget check leaves new Convex functions under the old app.
  - Pushes to `main` deploy directly, and the deployed suite then tests production after the fact.
  - Change: build and check first, deploy Convex second; gate promotion on the local-stack suite, which CI already runs; consider Rolling Releases for the app.
- **A4. Delete what reader unification left behind.** *(S–M, low risk)* About 1,900 lines have no consumer: `packages/wiki-shell/src/header.tsx`, `search.tsx`, `command-palette-outline.ts`; `OutlineShell` in `wiki-comments` (352 lines); 28 unused `PromptInput*` exports; a mobile-rail branch whose default is never used. 27 of 103 package export subpaths have no importer. Confirm with `knip` before deleting, since detection was name-based.
- **A5. Guard Web Storage in shared packages.** *(S)* `apps/app/src/safe-storage.ts` exists because one unguarded read crashes the reader into its recovery card, but packages cannot import it. 18 raw accesses in packages sit outside any `try`, several inside `useSyncExternalStore` snapshots (`wiki-shell/src/theme.ts`, `right-rail.tsx`, `resizable-layout.tsx`). Move the helper to a shared package and lint for raw access.
- **A6. Finish the Convex model work.** *(L, migration risk; reuse the dual-write recipe)*
  - Complete the `documentMeta` split: bodies and the 1536-float embedding still share the `documents` row.
  - Move runtime fields off the `sites` row into `siteRuntime`; every function reads that row and publishing writes it.
  - Make `siteId` required and drop the legacy indexes and second lookups (`convex/documents.ts:116-155`).
  - Add an index so asset overlays skip public and tombstoned rows.
- **A7. Server robustness.** *(S–M)*
  - `request.signal` never aborts, because `requestFromIncoming` builds the `Request` without one (`server/http-adapter.ts:91-95`); eleven call sites that pass it to Blob, Convex or model calls are no-ops, so a client disconnect cancels nothing.
  - Rate limits are per-instance maps; `/api/login` and `/api/auth/signin` have none, and `scryptSync` blocks the event loop (`server/user-auth.ts:15`) *(code)*.
- **A8. Break up the five worst components.** *(M each)* `DicomViewerClient` is one 1,411-line function with 20 `useState` and 14 refs; `DicomCompareClient` (1,080 lines) repeats its viewport setup; `CommentsShell` is 1,018 lines; `ChatInterface` is 794. Extract shared hooks first, then split.
- **A9. Dependency hygiene.** *(S)*
  - Unused dependencies in `apps/app`: `marked`, three `hast-util-*` packages, `github-slugger`. `swr` is imported but undeclared.
  - Two `lucide-react` majors are installed.
  - A stale `bun.lockb` sits beside `bun.lock`.
  - `shadcn` is a runtime dependency for one CSS import.
  - Markdown goes through three stacks (react-markdown in `wiki-markdown`, `streamdown` in chat, a direct import in `SearchPage.tsx`).
- **A10. One education reader.** *(M)* `apps/app/src/education/EducationApp.tsx` (687 lines) and `apps/oncoguide` duplicate navigation, search and lesson chrome. Decide whether Diana's `/education` stays; then either move the shared pieces into `packages/education` or redirect and delete.
- **A11. Repo hygiene.** *(S)* `apps/app/specs` has 90 entries and no index (archive the dated experiments); three READMEs describe a layout that no longer exists; `wiki-vite` appears about 290 times outside docs. Rename scripts and CI jobs, but leave storage keys and OPFS directory names alone because they are persisted identifiers.

In good shape and not worth churning: the package dependency graph (no cycles, no package imports an app), TypeScript strictness, error boundaries, the post-cull end-to-end structure, the bundle budget script, and vendor chunk hash stability.

## 6. Accessibility

Public pages are in good shape. The reader passes its current gate (axe, serious and critical only, desktop, light theme, six surfaces) while failing users in ways axe does not detect.

**Verified in the browser:**

| Finding | Evidence | WCAG |
| --- | --- | --- |
| No way past the navigation | No skip link in the reader. 70 Tab presses did not reach `<main>`; 66 of the stops were tree rows. | 2.4.1 |
| Route changes are silent | After Enter on a tree link, focus stays on the link and the live region is empty. | 2.4.3, 4.1.3 |
| Back loses your place | Scrolled to 900 px, navigated, pressed Back: scroll position 0. | 2.4.3 |
| The tree is not a tree | No `tree`, list or level semantics; arrow keys do nothing. | 1.3.1, 2.1.1 |
| Tables trap and drop focus | A 30-table page has 30 unnamed tab stops and 30 toggles without `aria-expanded`. Expanding moves the table out of `<main>` into a body-level layer and focus falls to `<body>`. None of 150 header cells has `scope`. | 1.3.1, 2.4.3, 4.1.2 |
| The status region nags | "Checking…" is announced on every poll: 14 live-region changes in 200 s. | 4.1.3 |
| Contrast | Admin table headers (6–7 nodes), the chat placeholder, and the primary action on the private-page state in dark mode fail 4.5:1. | 1.4.3 |
| Structure | `/diagnostics` has two `<main>` elements and two `h1`s; `/search` and `/chat` have none; the sidebar `<nav>` and `<aside>` are unlabelled. | 1.3.1, 2.4.6 |
| Invisible tab stop | The sidebar collapse button takes focus while at `opacity: 0`. | 2.4.7 |

**From code reading:**

- **Focus indicators.** The global ring is 1 px at 50% opacity (about 2.3:1). Nine controls replace it with a background tint of about 1.1:1, including the workspace menu, the Search pill and the mobile header buttons. There are no `forced-colors` rules.
- **Overlays.** There are 14 hand-rolled overlays; six lack a focus trap, Escape handling or focus return (command palette modes other than files, both admin modals, the mobile comments panel, the DICOM series sheet, two menus).
- **Dark mode.** White text on `--brand` (#818cf8) is 2.98:1 in six places.
- **Motion.** 60 animation or transition declarations against 7 reduced-motion guards; eight smooth-scroll calls are unguarded.
- **Hover-only controls.** Conversation actions and "Edit message" in chat are invisible to keyboard and touch users.
- **Streaming chat.** A polite live region sits inside `role="log"` and may re-announce per token.

**Proposal:**

- **X1. Keyboard path through the reader.** *(S)* Skip link to `<main tabIndex={-1}>`; on route change move focus to the page title and announce "Loaded {title}"; restore scroll per history entry.
- **X2. One visible focus style.** *(S)* A single global `:focus-visible` rule with a 2 px full-opacity ring and offset; delete the overrides; add `forced-colors` support.
- **X3. A real tree.** *(M)* `role="tree"` with `treeitem`, `aria-level`, a roving tab index (one tab stop for the whole tree) and arrow, Home, End and type-ahead keys. This also fixes the 70-Tab problem for people who skip the skip link.
- **X4. Shared overlay primitives.** *(M)* Move the ten weaker overlays onto native `<dialog>` or the Base UI Dialog and Menu already used in `packages/chat`. Do this as part of D2.
- **X5. Tables.** *(M)* Expand in place or manage focus explicitly; add `aria-expanded`; make the scroll wrapper a named region only when it overflows; emit `scope` on header cells.
- **X6. Quiet status.** *(S)* Announce only user-initiated checks and real changes (falls out of P7).
- **X7. Contrast and structure fixes** for the items in the table. *(S)*
- **X8. Raise the gate.** *(S)* Run axe at all impact levels with WCAG 2.2 tags in light and dark, at desktop and mobile widths, across the 23 surfaces used here; add `eslint-plugin-jsx-a11y`; add scripted checks for Tab count to content, focus after navigation, and focus after closing each overlay.

## 7. Design consistency

**Rendered evidence (computed styles, 23 surfaces):**

- 15 distinct `h1` styles. In the app alone: wiki page 30px/700, admin 24px/400, comments 28px/400, diagnostics 24px/600, imaging 24px/650, state cards 22px/600. `/search` and `/chat` have no page title.
- 17 button heights (24 to 120 px), 8 corner radii, 44 font sizes.
- `/tags/:tag` and `/table-examples` render with no page container: a 16px/400 `h1` flush against the sidebar.
- Admin tables render in Courier, because the stylesheet names "Geist Mono", which is never loaded.
- The sidebar changes identity by route: the chat sidebar has no workspace switcher or way back to the wiki, while admin has "Back to wiki".
- Chat's example questions use emoji where every other surface uses lucide icons.

**From code reading:**

- **Tokens.** One canonical palette (`packages/wiki-shell/src/theme.css`) plus eight satellite sets that re-type or drift from it. "Brand" has five values (`#4f46e5`, `#6366f1`, `#2563eb`, `#3b82f6`, `bg-indigo-600`). There are 114 raw colours in CSS and 371 arbitrary-value Tailwind colour classes; 257 literal `border-radius` values against 4 uses of the radius token.
- **Two styling systems.** Hand-written CSS drives the app, shell, markdown and education; Tailwind drives chat, diagnostics and comments. All hand CSS is unlayered, so global rules such as `button, input { font: inherit }` and `a { color: inherit }` (`apps/app/src/styles.css:636-641`) override Tailwind utilities regardless of specificity.
- **Primitives.** The only shared components live in `packages/chat/src/components/ui`, and nothing outside chat imports them. `apps/app` has 71 raw `<button>` elements and no `Button`. There are ten dialog mechanisms with five scrim opacities, two forked `Tooltip`s, and a duplicated `.badge`.
- **Scales.** 23 breakpoint widths; z-index values with collisions at 40, 50 and 80 and no tokens.
- **Dark mode.** The pathology viewer has 31 hard-coded colours and no dark rules; the PDF viewer references `--bg` and `--text`, which are defined nowhere.
- **Safety net.** Visual regression is five macOS-only snapshots.

**Proposal:**

- **D1. One token source.** *(M)* Keep `theme.css` canonical; add type, spacing, radius, shadow, z-index, duration and breakpoint tokens; expose them all through Tailwind's theme; turn the satellite sets into aliases; delete fallback literals. Enforce with lint: no raw colours, no arbitrary-value colour classes.
- **D2. A UI package.** *(L)* Promote `packages/chat/src/components/ui` to a shared package: Button, Input, Dialog, Menu, Tooltip, Tabs, Badge, Skeleton, EmptyState, plus `PageShell` and `PageHeader`. Migrate one surface at a time. This is where X2 and X4 land.
- **D3. One page frame.** *(S–M)* Every in-app route renders inside `PageShell` with a `PageHeader`. This fixes the tag page, gives search and chat a title, and makes the sidebar's structure stable across routes.
- **D4. CSS layers.** *(M)* Put package CSS in `@layer components` and remove the unlayered element resets, so utilities behave as written. Review each visual diff.
- **D5. Dark-mode and font fixes.** *(S)* Pathology and PDF viewers; the phantom "Geist" and "Geist Mono" families; weights 650 and 550, which snap to other weights on non-variable system fonts.
- **D6. Baselines first.** *(S)* Before any of the above, add visual snapshots for the 23 surfaces in both themes, rendered in CI on Linux.

## 8. Roadmap

Sizes: S is up to two days, M up to a week, L several weeks, for one engineer working with agents. Each phase ends with a measurable exit.

**Phase 0 — truth and safety net (about a week).**
- M1, M2, M3: lab harness in CI, synthetic traffic labelled, blind spots fixed.
- D6, X8: visual baselines and the wider accessibility gate (as report-only at first).
- A2: repo-wide lint and complete unit runs.
- Quick wins that need no design: P7 (visible-only polling with backoff), X6, landing preload fix (part of P2), P20, P21, P15, X1, X2, D5, the tag page (part of D3).
- Exit: dashboards show real-user percentiles; the lab numbers in this document are reproduced by CI; polling volume drops by more than half.

**Phase 1 — content first (two to three weeks).**
- P1, P2, P5 (inline slice), P18.
- P6, P9, P10.
- P11, P22.
- A3 (deploy ordering), A5.
- Exit: mobile-profile time to article ≤ 2.5 s; landing LCP ≤ 2.5 s; "nothing changed" manifest check ≤ 40 ms at the origin.

**Phase 2 — structure (four to six weeks).**
- A1 (sync controller, typed bus), then P3 (server rendering) on top of it, then retire redundant cache layers.
- D1, D2, D3, D4 with X3, X4, X5 landing on the new primitives.
- P12, P13, P14, P16.
- A4, A9.
- Exit: mobile-profile time to article ≤ 1.2 s; real-user LCP p75 ≤ 1.2 s; all overlays on shared primitives; zero axe violations at any impact on the 23 surfaces.

**Phase 3 — depth (ongoing).**
- A6 (Convex model), P23 (publishing), P8 (push), manifest deltas, P17, P19, P4.
- A7, A8, A10, A11.

Order within phases matters in two places: A1 before P3, and D6 before any styling change.

## 9. Decisions needed

1. **Server rendering (P3).** It reverses the September decision to be client-rendered from startup. I recommend it, after P1 and P2 have shown how much remains, because it is the only change that makes first paint independent of JavaScript size.
2. **Private HTTP caching (P11).** Private pages and files would persist in the browser's HTTP cache after sign-out unless cleared. OPFS already stores them, so this is a policy question more than a new exposure.
3. **Store partitioning (P17).** Keying on user plus revocation epoch keeps previously downloaded pages on a device after access is granted to more pages, and must still purge on revocation.
4. **Production as a test target (M2).** Stopping the deployed suite against production removes a safety check; the local-stack suite and a small labelled smoke test would replace it.
5. **Diana's `/education` (A10).** Keep and share, or redirect to OncoGuide.

## Appendix: lab results

Medians of three runs. Times in milliseconds, sizes in KB over the wire (gzip).

| Profile | Scenario | FCP | LCP | Article | Tree | Blocking time | Requests | Total KB | JS KB | wasm KB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Desktop | Landing, cold | 388 | 388 | – | – | 0 | 58 | 962 | 595 | 0 |
| Desktop | Reader, gate, cold | 252 | 340 | 322 | 294 | 0 | 67 | 1,347 | 867 | 295 |
| Desktop | Reader, gate, warm | 136 | 136 | 119 | 119 | 1 | 66 | 9 | 1 | 0 |
| Desktop | Reader, gate, warm deep link | 108 | 236 | 221 | 98 | 0 | 65 | 8 | 0 | 0 |
| Desktop | Reader, signed in, cold | 248 | 300 | 276 | 326 | 0 | 67 | 1,294 | 867 | 295 |
| Desktop | Large page, cold | 264 | 620 | 499 | 309 | 179 | 70 | 1,478 | 944 | 295 |
| Desktop | Large page, warm | 112 | 408 | 287 | 99 | 167 | 65 | 61 | 1 | 0 |
| Mobile | Landing, cold | 2,320 | 5,676 | – | – | 0 | 58 | 962 | 595 | 0 |
| Mobile | Landing, warm | 632 | 1,948 | – | – | 0 | 58 | 306 | 0 | 0 |
| Mobile | Reader, gate, cold | 2,332 | 7,356 | 7,325 | 7,607 | 280 | 74 | 1,297 | 867 | 295 |
| Mobile | Reader, gate, warm | 592 | 592 | 571 | 571 | 179 | 64 | 8 | 1 | 0 |
| Mobile | Reader, gate, warm deep link | 488 | 880 | 857 | 479 | 153 | 65 | 8 | 0 | 0 |
| Mobile | Reader, signed in, cold | 2,328 | 7,360 | 7,328 | 7,620 | 275 | 74 | 1,297 | 867 | 295 |
| Mobile | Large page, cold | 2,340 | 9,504 | 9,022 | 8,332 | 1,301 | 75 | 1,374 | 944 | 295 |
| Mobile | Large page, warm | 496 | 1,660 | 1,217 | 484 | 1,134 | 65 | 4 | 1 | 0 |

Interaction latency, signed-in reader, 2,323-page vault (time from input to the next painted frame with the result):

| Interaction | 1× CPU | 4× CPU |
| --- | ---: | ---: |
| Expand a folder of 62 files | 32 ms | 47 ms |
| Expand into the virtualized range (212 rows, 43 in the DOM) | 30 ms | 50 ms |
| Navigate to an uncached 10 KB page | 40–58 ms | 89–154 ms |
| Navigate to a cached page | 33 ms | 47–61 ms |
| Navigate to a 279 KB page (first visit) | 293 ms | 1,062 ms |
| Navigate to a 279 KB page (cached revisit) | 248 ms | 1,015 ms |
| Leave the 279 KB page | 215 ms | 681 ms |
| Open the command palette | 40 ms | 73 ms |
| Palette keystroke, median of 12 | 32 ms | 32 ms |

Real users, 30 days, CI hours excluded:

| Span | n | p50 | p75 | p90 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Document TTFB (`nav-document`) | 433 | 155 | 286 | 528 | 849 |
| Entry script running (`boot-entry`) | 439 | 560 | 849 | 1,876 | 3,328 |
| LCP | 238 | 976 | 1,698 | 3,903 | 6,269 |
| Store boot complete | 180 | 1,077 | 1,767 | 4,662 | 5,351 |
| Reader ready | 142 | 738 | 1,391 | 9,509 | 28,272 |
| Route render | 129 | 185 | 235 | 303 | 348 |
| Page body request | 4,685 | 200 | 239 | 286 | 341 |
| Manifest check (cached copy held) | 10,761 | 303 | 369 | – | 630 |
| INP | 70 | 64 | 88 | 200 | 304 |

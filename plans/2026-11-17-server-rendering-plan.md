# P3 server rendering: design spike and plan (2026-11-17)

Status: plan for review. Nothing here is shipped. Scope: proposal item P3 ("Render the shell and article on the server, then hydrate"), `plans/2026-11-13-application-improvement-proposal.md` §4.1, §5 A1, §8 Phase 2, §9 decision 1. The throwaway prototype is on a separate commit marked SPIKE (`apps/app/spike/ssr/`). It changes no app source; the three render guards it needed are kept as `spike/ssr/server-safety.patch`.

## 1. Recommendation

Do it, in four stages behind a server flag. The client hydrates only when the document says it was server-rendered, so turning the flag off restores today's behaviour.

- **One tree.** The server renders the same element tree `ReaderSession` already renders while it presents the inlined payload before the store exists (`src/ReaderRoot.tsx:143-156`), from the same payload object it writes into the same response. The client calls `hydrateRoot` on that DOM. The store then attaches through the existing handoff (`ReaderRoot.tsx:92-95`). Nothing is cloned and nothing is swapped. This is what separates P3 from the September experiment (`specs/client-rendered-reader-2026-09-11.md`).
- **The payload stays.** It is the hydration data and it seeds the store (`bootstrap/seed-page.ts`). SSR adds HTML next to it. It does not add a new data path, a new redaction path or a new cache.
- **SSR is an enhancement that can fail.** If the payload is missing, the render times out or errors, or the page is over the size cap, the response is exactly today's document (payload only) and the client takes the `createRoot` path.
- **Retire the localStorage startup snapshot and the reader-shell cookie** once SSR is the default (stage 3). A snapshot must not drive a first render that has to match server HTML. And the cookie tells the server to skip the payload (`server/app-shell.ts:434`), which would also skip SSR.

## 2. Evidence (spike, 2026-11-17, laptop: macOS arm64, Node 25.9, Bun 1.3.12, React 19.2.6, React Router 7.15)

How it was measured. `spike/ssr/entry-server.tsx` renders the presenting tree (`spike/ssr/tree.tsx`: providers, `InitialReaderContext`, `App`) under `StaticRouter`. It is built with the app's own Vite config (`vite build --ssr`) and run in Node with no DOM globals. Fixtures are synthetic (`spike/ssr/make-fixtures.ts`):

- `normal`: perf-lab `wiki/treatment/treatment-note-1`, 11.9 KB of markdown.
- `panel18`: an 18-table, drug-panel-shaped page (18 × 48 rows × 8 columns), 121 KB.
- `large30`: perf-lab `treatment-note-0`, 279 KB, 30 tables, with math.

Each fixture carries the real navigation slice (`navigationSlice` → compact tree → sidebar tree). I did not read real Diana content; the curefirst page was imitated only by shape.

### 2.1 What renders, and what is not server-safe

Module scope is clean: the whole reader graph imports under Node with no `window`. Render-time problems, in the order they appeared:

| # | Where | Problem | Fix |
| --- | --- | --- | --- |
| 1 | `src/shell/ReaderStatus.tsx:23` `useBrowserOnline` | `useSyncExternalStore` has no `getServerSnapshot`, so the **whole render throws** ("Missing getServerSnapshot"). Hydration would throw too. | `() => true` server snapshot. `navigator.onLine` can be false on the client (it lies; see `sync/connectivity.ts:1-12`). That is then a post-hydration re-render, not a mismatch. |
| 2 | `src/shell/Header.tsx:165` | `document.getElementById("wiki-html-first")` in a state initializer. This is dead HTML-first code: nothing emits that node now. | Delete, with `seed-page.ts:57-58` and the `#wiki-html-first` rules in `styles.css:1893-1899`. |
| 3 | `src/shell/Header.tsx:119` | `authDialogOpen` starts from the pre-JS shortcut queue (`window.__wikiReaderShortcuts`) and `?reader-action`. On the server it is false. A key pressed before hydration would make the client render the dialog, which is a mismatch. | Start closed and open it in an effect after hydration. The queue already exists for this. |
| 4 | `src/pages/WikiPage.tsx:205` | `new URL(…, window.location.origin)` in render, used only for path+search+hash. | Use a constant base. |
| 5 | `packages/wiki-markdown/src/browser.tsx:19-36` | The optional math and raw-HTML stages load in **effects**, which never run on the server. Math pages rendered the loading fallback instead of the article. | Before rendering, the server awaits `preloadMarkdownMath`/`preloadRawHtml` when `mayContainMath`/`documentMayNeedRawHtml` match. The client must await the same before `hydrateRoot` (today `WikiViteRoot.tsx:201-210` only starts them in an effect). |
| 6 | `MarkdownTitle` and other `lazy()` children | `renderToString` cannot wait for Suspense, so it emitted a client-render fallback. | Use `renderToReadableStream` + `allReady` (verified: no fallbacks). On the client, a lazy boundary that is not loaded yet keeps the server HTML until its chunk arrives. |

Server-safe as written:

- `useReaderQuery` uses the same snapshot on server and client (`bootstrap/reader-queries.tsx:63`).
- Tree expansion has a server snapshot (`shell/tree-expansion.ts:5,81`).
- Sidebar width uses `DEFAULT_WIDTH` (`wiki-shell/src/resizable-layout.tsx:81`).
- Theme hooks use a `null` server snapshot (`Header.tsx:247-251`).
- `ReaderAgentTools` and the devtools footer render only once a store exists (`webmcp/agent-tools.tsx:20`, `App.tsx:195`).
- Every `useLayoutEffect` is effect-only; React 19 no longer warns about them on the server.
- No OPFS or LiveStore hook runs in the first frame: `StoreScoped` renders nothing without a store (`reader-queries.tsx:68-71`).

With fixes 1, 3 and 4 applied (`spike/ssr/server-safety.patch`) and fix 5 done in the harness, all three fixtures render the chrome, the slice tree and the full article with no client-render fallback.

What the spike did **not** render: `main.tsx`'s root, `WikiViteRoot` and `ReaderRoot`. They read `location`, `document` payload nodes, meta tags and localStorage in their state initializers (`WikiViteRoot.tsx:139-194`, `ReaderRoot.tsx:65`, `main.tsx:17-18`). The spike constructed their output directly. Making those initializers a pure function of the document is stage 0's main work, and it is A1's remaining step (§3.1).

### 2.2 Server render time (Node, `NODE_ENV=production`, 20 iterations)

| Fixture | Markdown | HTML (raw / gzip) | `renderToString` p50 / p90 | `renderToReadableStream` + `allReady` p50 / p90 | Markdown alone | Chrome + slice tree |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| normal | 11.9 KB | 97 KB / 9.8 KB | 7.7 / 10.5 ms | 12.3 / 16.3 ms | 5.6 ms | ~1 ms |
| panel18 | 121 KB | 739 KB / 36 KB | 159 / 195 ms | 165 / 270 ms | 142 ms | ~1 ms |
| large30 | 279 KB | 902 KB / 86 KB | 198 / 280 ms | 192 / 273 ms | 182 ms | ~1 ms |

- About 90% of render time is markdown parsing and the react-markdown tree. The chrome costs about 1 ms, so P12 (parse once, keyed by content hash) pays twice.
- A large page is CPU-bound for 150–200 ms on a laptop, so expect ~2× that on a Vercel vCPU. On Fluid compute that blocks the instance's other concurrent requests.
- panel18 peaked at **~290 MiB RSS**, against 90 MiB for a normal page.
- The HTML is the honest DOM: 6,912 `<td>` with smart-table classes. The payload still carries the markdown, so a document holds both.

### 2.3 Bundle and cold start

- Today `bun scripts/build-vercel-functions.ts` reports **Reader HTML startup: 185.0 KiB in 18 modules** against `READER_SERVER_BUDGET_BYTES = 200 KiB` (`scripts/reader-server-budget.ts:34`). The 256 KiB the proposal cites is the API budget (`:38`). That leaves 15 KiB of headroom, so the renderer cannot be a static import.
- Renderer fully bundled (`SPIKE_BUNDLE_ALL=1`, minified): **1,267 KiB static closure (385 KiB gzip) in 30 modules**.
  - `vendor-react` is 545 KiB of that. It carries both the legacy and the stream server builds plus the client `react-dom`; using only `renderToReadableStream` should drop roughly a third (to measure).
  - `vendor-markdown` is 367 KiB and the app code 97 KiB.
  - Math (`vendor-math`, 263 KiB) and raw HTML stay behind dynamic imports.
- Cold start, measured in a fresh Node process (`spike/ssr/coldstart.mjs`, 5 runs):
  - Module evaluation: **34–47 ms**.
  - First render of a normal page: **53–61 ms**, against 15–18 ms warm, so ~40 ms is JIT warm-up.
  - Together that is ~75–100 ms on a laptop. At ~2× on Vercel, budget **+150–200 ms on a cold instance's first SSR request**, against today's shell cold start p50 of 89 ms.
  - Start the `import()` when the request arrives, in parallel with the gate and session reads. Signed-in documents already wait 100+ ms for those reads, so most of the import cost overlaps them.
- Runtime: `renderToReadableStream` works under Node (Vercel's runtime; `react-dom/server.node` exports it in React 19) and under Bun (the standalone server and the local stack resolve `server.bun`). Both were exercised.

### 2.4 Hydration, in Chromium (`spike/ssr/hydrate-check.ts`)

The SSR HTML plus a client build of the same tree (`hydrateRoot`, `BrowserRouter`) is served gzipped from a static server, with `onRecoverableError` recorded. There are 3 fixtures × 8 client conditions. That makes the numbers below a lower bound on real time: the static server does no origin work, so add production TTFB.

- **Zero recoverable hydration errors** in all 24 cases. The conditions were: dark system theme, saved sidebar width, saved collapsed sidebar, saved tree expansion, `navigator.onLine === false`, and 390 px mobile. Hooks with a server snapshot re-render after hydration instead of mismatching.
- **The mismatches turn into layout shift** (desktop, unthrottled):

  | Client condition | CLS |
  | --- | ---: |
  | Clean (baseline) | 0.018 |
  | Saved sidebar width 360 | **0.078** |
  | Saved collapsed sidebar | **0.155** (fails the surface gate's 0.1, `surface-gates/layout-shift.spec.ts:13`) |
  | Saved tree expansion | +0.006 |
  | Mobile | 0 |

- **Mobile lab profile** (390×844, DPR 3, 4× CPU, 1.6 Mbps, 150 ms RTT; medians of 3):

  | Fixture | FCP | LCP | Controls live (React props on the header button) | Longest task while hydrating |
  | --- | ---: | ---: | ---: | ---: |
  | normal | 1.12 s | 1.42 s | 1.97 s | 64 ms |
  | panel18 | 1.27 s | 1.84 s | 2.06 s | **845 ms** |
  | large30 | 1.48 s | 1.82 s | 3.11 s (math chunk preload 575 ms) | **708 ms** |

  - Today's lab time to article is 2.3 s on this profile (after P1/P2). The September experiment measured 318 ms vs 1,416 ms on desktop.
  - **First paint stops depending on JavaScript.** It is bounded by HTML plus the single 49 KB-gzip stylesheet. Reaching ≤ 1.2 s LCP with real TTFB likely needs P4 (reader-only CSS) as well.
  - **Hydration still runs the whole markdown render on the client.** Large pages trade the blank screen for one long task (INP risk). P12 and P14 still apply, and an article-level `<Suspense>` boundary lets React hydrate the chrome first and yield.
  - **Controls are inert for about 0.8 s on a normal page** on mobile: paint at ~1.1 s, hydration done at ~2.0 s. Links are real `<a href>` elements and navigate natively. Buttons (search, tree toggles, the drawer, account) do nothing until hydration. Keyboard shortcuts are already queued before JavaScript (`bootstrap/reader-shortcuts.ts`). This is the only behaviour September's design avoided by not painting at all. See open question 1.

### 2.5 Privacy and caching (from code)

Both payloads are already built from exactly what the reader's own API would return to this request:

- **Public:** `publicPayload` → `redactPageContent` (`server/app-shell.ts:507-530`, `server/reader-access.ts:280-300`), and only for `sensitive === false` pages (`server/page-bootstrap.ts:13`).
- **Signed-in:** the page and session APIs are dispatched in-process with this request's headers (`app-shell.ts:374-391, 541-558`), and the result is sent only in a `private, no-store` response.

SSR keeps that by construction:

- The server renders only the `InitialReaderData` it obtains by **parsing its own serialized payload through the client's parser** (`initialReaderData` / `pageBootstrapFor`, `bootstrap/initial-reader-data.ts:48-62`). The HTML therefore contains nothing the response does not already carry, and both sides start from the same value.
- Response headers do not change. `htmlHeaders` (`app-shell.ts:565-611`) answers `private, no-store` for any gate, session, shell hint or unknown identity. Diana's production site is gated, so every Diana document stays `private, no-store`.
- Only an ungated site's anonymous document gets `public, max-age=60, s-maxage=300, stale-while-revalidate=3600` (`:604-610`). Those documents already inline the public payload today, so SSR HTML is CDN-cacheable on the same terms. After a publish the CDN can serve stale HTML for up to an hour, and the store's revalidation then replaces the article in place. The inlined payload already behaves this way today.

## 3. Design

### 3.1 Client: where `hydrateRoot` replaces `createRoot`

- `main.tsx:149` keeps `createRoot` and gains a branch: if `#root` has `data-ssr="reader"`, call `hydrateRoot(root, sameTree, { onRecoverableError })`. Every recoverable error goes to telemetry as a `hydration-mismatch` span with the component stack, and to `window.__WIKI_HYDRATION__` for e2e.
- `main.tsx:166` already waits for the reader module before the first render, which hydration needs: there is no lazy boundary at the reader root. It must also await the optional markdown stages the payload needs (§2.1 #5).
- **Boot inputs object (stage 0, finishes A1).** Read the document once in `main.tsx` into `ReaderBootInputs`: URL, page payload text, navigation payload text, session answer, access and landing flags, site. Make the initial state of `WikiViteRoot`, `ReaderRoot` and `RootRouteBoundary` a pure function of it. The server builds the same object from the payload it is about to write. A unit test asserts `initialState(serverInputs)` deep-equals `initialState(parse(renderedDocument))`.
- **The startup snapshot must not drive a hydrated first render.** On an SSR document `WikiViteRoot` skips `readStartupSnapshot()` (`WikiViteRoot.tsx:139-145`), because the server copy is newer. The 60 s payload freshness window (`BOOTSTRAP_MAX_AGE_MS`) starts at hydration for SSR documents, not at byte receipt. Otherwise a phone that takes longer than a minute to boot would render `ReaderPending` against server HTML.
- **Store handoff is unchanged.**
  - `ReaderSession` presents from `InitialReaderContext`.
  - `StoreHost` loads after the first frame (`ReaderRoot.tsx:115-129`) and seeds the same payload (`seedInitialPage`).
  - `PublishReaderStore` hands off; `useReaderQuery` switches source, but the values are identical.
  - The slice tree is replaced when the manifest syncs, as it is today.

### 3.2 Server

- A new Vite SSR build of `src/server-entry.tsx`, from the same config and environment as the client so `import.meta.env` and chunk names agree. It goes into `.vercel-functions/` (already covered by `includeFiles`). The shell imports it lazily, as `root-app-shell.ts:18` already does for `app-shell`, and the standalone server imports the same module.
- In `staticIndexHtml`, the public and session branches return `{ rootHtml, dataScripts }` instead of `dataScripts`.
- The stream (`app-shell.ts:739-760`) cuts at `<div id="root">`, not at `</body>`, and sends:
  1. The head, unchanged. The stylesheet and the head script's requests still start at once.
  2. `<div id="root" data-ssr="reader">` plus the streamed render.
  3. `</div>`, the data scripts, and the rest.
  4. `data-reader-payload` as today.
- The render is bounded: abort after a budget (start at 250 ms) and emit the payload-only document. A page over a size cap gets no SSR: start at 64 KiB of markdown, which covers normal pages, and raise it as P12 lands. `WikiPage` already treats over 128 KiB as long (`pages/WikiPage.tsx:592`).
- An in-memory LRU of rendered article HTML is keyed by `contentHash` of the **redacted** markdown plus the reader cache version. It is content-addressed, so a hit can only serve a request that produced identical input. This one is optional, in stage 4.

### 3.3 Layout and mismatch hazards and their mitigations

| Source | Today | Under SSR | Mitigation |
| --- | --- | --- | --- |
| Theme (localStorage + `prefers-color-scheme`) | Head script sets `.dark` before paint (`index.html:10-23`) | No flash. The toggle re-renders once (null server snapshot). Measured: 0 mismatches. | None |
| Sidebar width / collapsed (localStorage) | Read on mount | CLS 0.078 / 0.155 | A head script sets `--wiki-sidebar-width` and `data-initial-sidebar-state` from storage, next to the theme script. The layout reads the CSS variable, so the HTML stays identical for every user and stays cacheable. Do not use a cookie. |
| Tree expansion (localStorage) | Applied on mount | Small sidebar-only shift (+0.006) | The server opens the current page's ancestors (the slice), and saved choices merge after hydration. Accept, and watch the surface gate. |
| `navigator.onLine` | Read in render | Post-hydration label change | Server snapshot `true` (§2.1 #1) |
| Queued shortcuts, `?reader-action` | Read in a state initializer | Mismatch | Consume in an effect (§2.1 #3) |
| Startup snapshot / public identity in localStorage | Chooses the first tree | Mismatch | Not read for SSR documents (§3.1) |
| Payload age (`Date.now()`) | 60 s from receipt | Mismatch if late | Starts at hydration (§3.1) |
| Dates, random IDs | None in the first frame: `useId` only. `Date.now`/`Math.random` sit in comments, mermaid and the guest user, all after the store or in effects. | None | Unit check: render twice, byte-equal |
| Viewport (mobile drawer, header) | CSS media queries. Both layouts are in the DOM and the drawer starts closed. | Mobile CLS 0 | None |
| Smart-table measurement | Pretext loads near the viewport (`050704b3a`) | panel18 CLS 0.006–0.011 | Keep the layout-shift gate on `reader-big-tables` |
| Feature flags | `webMcpAvailable()` and devtools render only with a store | None in the first frame | Rule: first-frame components may read only boot inputs |
| Optional markdown stages | Effect-loaded | Fallback on the server and a mismatch on the client | Preload on both sides (§2.1 #5) |

## 4. Stages

Each stage is one PR series, flag-controlled: `WIKI_READER_SSR = off | opt-in | public | all`. `opt-in` honours `?readerSsr=1` (lab and e2e); `?readerSsr=0` always opts out.

**Stage 0. Server-safe first frame (S–M, no behaviour change).**

- Work:
  - Fixes 1–5 from §2.1.
  - Delete the dead `wiki-html-first` code and the first-frame snapshot leftovers (`livestore/first-frame-snapshot.ts`, the key sweep in `main.tsx:32-38`).
  - The boot inputs object (§3.1).
  - The sidebar head script.
  - `src/server-entry.tsx` plus its Vite SSR build in CI, with a new `READER_SSR_BUDGET_BYTES` (start at 1,400 KiB and ratchet down). The HTML-handler budget stays at 200 KiB: the renderer must remain a dynamic import.
- Tests:
  - `server-entry.test.tsx` (bun, no DOM). Fixtures: normal, math, raw HTML, mermaid, 18-table, sensitive, redaction canary. Asserts: no `<template data-msg` fallback; article and tree present; two renders byte-equal; the HTML contains a canary only if the payload does.
  - Boot-inputs equality (§3.1).
- Exit: CI green, with the SSR bundle built and budgeted. No user-visible change.

**Stage 1. Public-scope documents, opt-in, then `public` (M).**

- Scope: ungated anonymous documents and gate guests (public payload; `private, no-store` on gated sites). Not education, not session documents.
- Tests:
  - Extend `e2e/contract/content-first.spec.ts`. With scripts held, `#root` already contains the article and tree. `window.__WIKI_HYDRATION__` is empty after hydration. "A user without access gets no restricted page, content or slugs in the document" also covers the HTML.
  - A mocked hydration matrix spec covering every condition in §3.3, plus a key queued before hydration and a link clicked before hydration.
  - Surface gates (`surfaces:gates` plus `visual.spec.ts`) with SSR forced on. Visual baselines must not change after settle.
- perf:lab changes:
  - Add a `gate-cold` scenario (the proposal appendix had one) and an `--ssr on|off` A/B.
  - Replace the "first `.wiki-markdown p` in DOM" metric, which under SSR fires at HTML parse, with **`articlePaintMs`**: Element Timing on the article's first block, recorded in RUM as well.
  - Add `inertMs` (hydration complete minus article paint), `hydrationLongestTaskMs`, and the server `shell.render` span.
- Exit to stage 2:
  - Mobile lab `gate-cold` `articlePaintMs` ≤ 1.5 s, down from about 2.3 s. The ≤ 1.2 s Phase 2 target is expected only with P4.
  - Zero hydration errors in the e2e matrix. RUM mismatch rate < 0.1% of SSR loads over 7 days.
  - Every layout-shift gate under 0.1.
  - `shell.render` p95 ≤ 60 ms for pages under the cap. Shell function p95 up by no more than 80 ms. Cold start p50 up by no more than 100 ms.
  - No change in the document 5xx rate.

**Stage 2. Signed-in session documents (M).**

- Scope: the same tree from the session payload, in the same `private, no-store` response. This is the stage that moves the lab's signed-in number.
- Tests: the restricted-page contract specs (`content-first.spec.ts:58-129`) assert on HTML as well as payload. Sign-out and account switch: the payload nodes are removed (`WikiViteRoot.tsx:150-158`), and so is server HTML from a previous identity (a remount, as today).
- Exit to stage 3: mobile lab `signed-in-cold` `articlePaintMs` ≤ 1.5 s; RUM LCP p75 for the SSR cohort (`firstPaintSource: "server"`) ≤ 1.2 s; no rise in `session-recovery` or `StoreStartupRecovery` rates.

**Stage 3. Default on, then retire the redundant layers (S–M).**

- Order:
  1. `WIKI_READER_SSR=all` for two weeks.
  2. Remove the reader-shell cookie and its payload skip (`reader-shell-hint.ts`; `app-shell.ts:224, 434, 594`).
  3. Delete the localStorage startup snapshot: `reader-startup-cache.ts`, `ReaderStartupCacheWriter.tsx`, `seed-startup-cache.ts`, `startup-cache-*.ts`, `encode-startup-cache.ts`, the `cached` branch in `WikiViteRoot`/`ReaderRoot`, and the session-handoff path that exists only for a cached public page meeting a session (`session-handoff.ts`, `SessionHandoffSync`). That is about 360 lines in `src/bootstrap` plus its call sites in 7 files and its e2e (`resilience/identity-cache.spec.ts`, parts of `journeys/public.spec.ts`, `visual.spec.ts`).
  4. Update `CACHE-LAYERS.md`.
- Exit before step 3: mobile lab warm `articlePaintMs` ≤ 600 ms **without** the snapshot (571 ms with it today). The palette's full-tree search before sync (`0669ab09b`) then waits for the manifest, which is requested after the first frame. Confirm that is acceptable.

**Stage 4. Large pages (with P12/P14).**

- Raise the size cap as parsing gets cheaper. Add the content-addressed render cache (§3.2). Wrap the article in its own Suspense boundary, and per-section if needed, so hydration yields.
- Exit: `panel18` and `large30` SSR'd under the cap; mobile `hydrationLongestTaskMs` ≤ 200 ms on the large page (845 / 708 ms in the spike).

## 5. Afterwards: what goes and what backing out costs

- **Deleted:**
  - The localStorage startup snapshot and its writer, epoch, seeding and cookie.
  - The session-handoff special case.
  - The first-frame and `wiki-html-first` leftovers.
  - `firstPaintSource: "snapshot"`.
- **Stays:**
  - The inlined payload (hydration data and store seed).
  - The head early-request script (session/page requests for documents without a payload, plus the runtime downloads).
  - OPFS, LiveStore and `?v=`.
- **Backing out before stage 3:** set the flag to `off`. The server stops emitting `data-ssr` and the client takes `createRoot`. Nothing else changes and no data migrates. The ongoing cost is keeping `createRoot` and `hydrateRoot` on one tree, which is a single branch in `main.tsx`.
- **Backing out after stage 3:** set the flag to `off`, and repeat visits lose the snapshot's 572 ms first paint. They fall back to the P1/P2 path (about 2.3 s cold on mobile; warm is OPFS-dependent) until the deletion commit is reverted. That commit is self-contained, so keep it as one commit.

## 6. Risks

- **Inert controls between paint and hydration** (~0.8 s on mobile for a normal page). This is the September failure mode in a smaller form. Measure `inertMs`, and decide on click capture (open question 1).
- **CPU-bound renders on shared Fluid instances.** One 18-table page holds the event loop for 150–300 ms and ~290 MiB. Mitigated by the size cap, the render budget, the render cache and P12.
- **Server/client skew.** The SSR bundle and the client chunks come from one build. An HTML document cached by the CDN references its own build's chunks, which P22 keeps available.
- **Hidden mismatches.** Server snapshots convert mismatches into post-hydration re-renders: no error, but possibly a shift. The CLS gates and visual specs, not the error counter, catch these.
- **Larger documents.** HTML and payload carry the content twice: normal +9.8 KB gzip, panel18 +36 KB. Fine for normal pages; the cap covers the tail.

## 7. Open questions

1. **Inert window.** Accept ~0.8 s of inert buttons on mobile (links work, shortcuts queue), or extend the pre-JS shortcut script to capture clicks on `[data-reader-action]` controls and replay them after hydration? I lean towards accepting it for stage 1, measuring it, and adding capture only if RUM shows taps in the window.
2. **Size cap.** Start at 64 KiB of markdown? I need the production page-size distribution (from the manifest) to know what share of loads that covers.
3. **Public CDN caching.** Should ungated SSR HTML keep `s-maxage=300, stale-while-revalidate=3600` (stale for up to an hour after a publish, then replaced in place), or should SSR documents get a shorter window? Separately: `Vary: User-Agent` on public HTML (`app-shell.ts:610`) fragments the CDN cache. Is it still needed?
4. **The snapshot's other jobs.** Deleting it loses full-tree palette search before the manifest arrives, and the instant repeat-visit paint on a flaky network. Is a 600 ms warm-load bar enough to delete it?
5. **Order against P4.** The spike shows first paint bounded by the 49 KB-gzip stylesheet. Reaching ≤ 1.2 s probably needs P4. Do P4 alongside stage 1, or accept 1.5 s as the P3 exit?
6. **Education and other routes.** Stage 1 excludes `/education`, `/search`, `/tags/*` and the special routes. Should any of them be in P3 scope, or left to P19 (prerendered marketing)?

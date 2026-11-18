# P3 server rendering: design spike and plan (2026-11-17)

Status: plan for review. Nothing here is shipped. Scope: proposal item P3 ("Render the shell and article on the server, then hydrate"), `plans/2026-11-13-application-improvement-proposal.md` §4.1, §5 A1, §8 Phase 2, §9 decision 1. The throwaway prototype is on a separate commit marked SPIKE (`apps/app/spike/ssr/`). It changes no app source. The app-source edits it needed are patch files:

- `spike/ssr/server-safety.patch`: the first spike's three render guards.
- `spike/ssr/hydration-path.patch`: the paint-to-responsive spike (§8).

Revision 2 (same day) adds §8 and updates §1, §4, §6 and §7. The user decision behind it: input made before hydration must be replayed, not dropped. Nothing lands until the gap between article first paint and the page responding to input is under 100 ms on the mobile lab profile.

## 1. Recommendation

Do it, in four stages behind a server flag. The client hydrates only when the document says it was server-rendered, so turning the flag off restores today's behaviour.

- **One tree.** The server renders the same element tree `ReaderSession` already renders while it presents the inlined payload before the store exists (`src/ReaderRoot.tsx:143-156`), from the same payload object it writes into the same response. The client calls `hydrateRoot` on that DOM. The store then attaches through the existing handoff (`ReaderRoot.tsx:92-95`). Nothing is cloned and nothing is swapped. This is what separates P3 from the September experiment (`specs/client-rendered-reader-2026-09-11.md`).
- **The payload stays.** It is the hydration data and it seeds the store (`bootstrap/seed-page.ts`). SSR adds HTML next to it. It does not add a new data path, a new redaction path or a new cache.
- **SSR is an enhancement that can fail.** If the payload is missing, the render times out or errors, or the page is over the size cap, the response is exactly today's document (payload only) and the client takes the `createRoot` path.
- **The first visible frame is already interactive, and earlier input is never dropped** (§8).
  - A head script captures clicks and keys from first paint and replays them into the same node once React has hydrated it.
  - The chrome hydrates first; the article body hydrates later, section by section.
  - The entry module is render-blocking until the root pass has committed.
  - On the mobile lab profile, input at paint gets a response in 42–89 ms (median; worst 96 ms) on a normal page and on an 18-table page.
  - The price is first paint: about 1.9 s, against 1.3–1.5 s ungated, in the same harness. It is still well ahead of today's 2.3 s client-rendered article.
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

**Stage 0. Server-safe first frame (S–M, no behaviour change).** Landed on branch `ssr-stage0` (2026-11-17, not pushed).

- **Server-safety fixes (§2.1)**, each covered by a test that renders under Bun with no `window` or `document` (`src/server-safety.test.tsx`; the `useBrowserOnline` and dialog cases fail on the old code):
  1. `useBrowserOnline` has a server snapshot (online).
  2. The dead HTML-first code is gone: the account state no longer reads `#wiki-html-first` in render, seeding no longer stamps it, and `styles.css` no longer styles it.
  3. The startup sign-in request (shortcut queue, `?reader-action=signin`) is captured as data and exposed through `useSyncExternalStore` with a server snapshot of `false`. A client render opens the dialog in its first render, as before; a server render, and a hydrating client, start closed.
  4. `WikiPage`'s sign-in link comes from `signInHrefFor` (path only, no `window.location.origin`).
  5. `preloadOptionalMarkdownStages` (`@oncobase/wiki-markdown/optional-stages`) loads exactly the math and raw-HTML stages `WikiMarkdown` would wait for, using its own two checks.
- **Sidebar head script** (`wiki-shell/src/sidebar-startup.ts`, injected by `vite.config.ts`):
  - It puts the saved width and collapse state on `<html>` before the first paint: `data-initial-sidebar-state` and `--wiki-sidebar-width`.
  - The rail's width is `var(--wiki-sidebar-width, 256px)`, the same markup for every visitor. The current client uses the variable too, and `setResizableSidebarWidth` keeps it in sync.
- **Boot inputs (§3.1)**: `ReaderBootInputs` plus three pure derivations (`documentSessionIdentity`, `documentPublicIdentity`, `documentInitialReaderData`).
  - The client still snapshots the live document at the old moments: seeding removes the payload nodes, and a consumed page must not be read again.
  - `boot-inputs.test.ts` builds documents with the server's own `page-bootstrap.ts`, reads them back from the HTML, and gets the same identity and first frame.
- **The renderer** `src/server-entry.tsx`: `firstFrameFor` and `ReaderFirstFrame` (main.tsx's boundaries over `PresentingReader`, which `ReaderSession` now renders too).
  - `renderReaderFirstFrame` returns null without a presentable payload, on error, or over its time budget (250 ms default, enforced by elapsed time as well as the abort signal).
  - It uses `react-dom/static` `prerender` with `progressiveChunkSize: Infinity`. **Finding:** a streamed render outlined the article (a lazy module suspends on first use) and revealed it from an inline `$RC` script, behind React 19.2's ~300 ms reveal throttle, so the first paint would have been the skeleton.
  - `server-entry.test.tsx`: no fallback or outlined boundary; byte-identical renders; math; raw HTML; 18 tables; a session page only for its identity and never under `?scope=public`; null for no payload, a sensitive page, or over budget.
- **Build and budget**: `scripts/build-reader-ssr.ts` builds the renderer into `.vercel-functions/reader-ssr/` from `build-vercel-functions.ts`, with everything bundled.
  - `READER_SSR_BUDGET_BYTES` = 1,080 KiB against a measured 1,021.0 KiB in 31 modules. The build fails if the renderer is missing, over budget, or statically imported by the HTML handler (185.6 KiB of 200 KiB).
  - Under Node 25 the built module imports in 37 ms and renders a small page in 54 ms cold, 6 ms warm.
  - No response uses it, so `WIKI_READER_SSR` is not needed yet.
- **Not done in stage 0**, moved to stage 1 or left as written:
  - The replay script and the render gate (§8.6 items 1 and 5): stage 1, by decision.
  - The chrome-first hydration path (§8.6 items 2–4 and 6): stage 1. Each changes the client-rendered reader's behaviour (lazy body, Suspense boundaries, palette in the paint set).
  - The first-frame snapshot leftovers (`dismissFirstFrameSnapshot`, `main.tsx`'s key sweep): kept. They still retire nodes and keys written by older releases.
  - Mermaid and redaction-canary renderer fixtures: stage 1, with the wired response.
- **Critical-path trims** (separate commits, each an A/B from the same base: `vite build`, then the paint closure from `check-bundle-budget.ts`, fflate gzip level 6):

  | Change | Paint set before → after (gzip bytes) | Notes |
  | --- | ---: | --- |
  | Budget counts the real entry (`bundle-entry.ts`) | 320.2 → 314.9 KiB as counted (−5,022 B) | Measurement fix: swr's `index-*.js` (5,022 B, DICOM/pathology only) matched the entry pattern. No download changed. Allowance moved paint → lazy |
  | Palette modules out of the wiki-shell index | 322,464 → 317,967 B (**−4,497 B**) | The index re-exported `palette.tsx` and `command-palette-pages.ts` (with fuzzysort), so they were placed in the paint-critical shell chunk (20,811 → 16,315 B). `"sideEffects"` alone did nothing (−14 B). CommandPalette now imports subpaths |
  | Lazy-title wrapper | not a saving | Real build: the wrapper is inside the renderer chunk and `title-react-impl` is a 0.5 KiB lazy chunk. The 13.6 KiB in §8.6 came from the spike's chunking |
  | React Router production build | ~0.5 KiB | Done on main (43779c2ae). The 14.2 KiB claim in §8.6 was wrong |
  | lucide icons built per icon (measured, **not committed**) | 317,967 → 313,659 B (−4,308 B) | `vendor-icons` held all 142 icons any route uses, on the paint path (the lucide index is re-exported the same way). Building each icon from its own module moves 138 off paint, but the total grows +9.5 KiB (29 single-icon lazy chunks) and WikiViteRoot's budget would need +3.2 KiB. Needs a decision (open question 8) |
  | P4 per-surface CSS | not attempted | The stylesheet is 64,866 B of the paint set. Splitting it means explicit `<link>`s per surface and reverses `cssCodeSplit: false`; not contained enough for stage 0 |

  - Stage 0's own additions, measured the same way: sidebar script +~0.1 KiB, boot inputs +599 B (a shared 1.6 KiB chunk).
  - Final paint set: 318,726 B (311.3 KiB) against 322,464 B for the corrected main base.
- Exit (met, 2026-11-17):
  - `bunx turbo run lint typecheck test:unit --continue`: 46 of 46 tasks green.
  - Fresh `bun run build` and bundle budget green.
  - Mocked e2e: 154 passed, 79 skipped (env-gated), 0 failed.
  - Surface gates on the local stack (`surfaces:gates`): 121 of 121 passed.
  - Layout shift with the two new saved-sidebar cases (360 px and collapsed reader article): 33 of 33 under 0.1.

**Stage 1. Public-scope documents, opt-in, then `public` (M).**

- Scope: ungated anonymous documents and gate guests (public payload; `private, no-store` on gated sites). Not education, not session documents.
- Tests:
  - Extend `e2e/contract/content-first.spec.ts`. With scripts held, `#root` already contains the article and tree. `window.__WIKI_HYDRATION__` is empty after hydration. "A user without access gets no restricted page, content or slugs in the document" also covers the HTML.
  - A mocked hydration matrix spec covering every condition in §3.3, plus a key queued before hydration and a link clicked before hydration.
  - Replay spec (§8.7): click, Enter and Space on a control before hydration are replayed exactly once; a link before hydration navigates natively; Ctrl+K at paint opens the palette; a field typed into before hydration keeps its text; nothing is replayed after the node is gone.
  - Surface gates (`surfaces:gates` plus `visual.spec.ts`) with SSR forced on. Visual baselines must not change after settle.
- perf:lab changes:
  - Add a `gate-cold` scenario (the proposal appendix had one) and an `--ssr on|off` A/B.
  - Replace the "first `.wiki-markdown p` in DOM" metric, which under SSR fires at HTML parse, with **`articlePaintMs`**: Element Timing on the article's first block, recorded in RUM as well.
  - Add `inertMs` (hydration complete minus article paint), `hydrationLongestTaskMs`, and the server `shell.render` span.
  - Revision 2: port the spike's `gap.ts` probes as **`paintToResponsiveMs`** (§8.1), plus the idle-baseline and dropped-input counts.
- Exit to stage 2:
  - Revision 2, gating: `paintToResponsiveMs` under 100 ms, median **and** worst of 5 cold loads, on the mobile profile, for a normal page and the 18-table page, for both the drawer click and Ctrl+K. Zero dropped inputs after paint.
  - Mobile lab `gate-cold` `articlePaintMs` ≤ 1.5 s, down from about 2.3 s. The ≤ 1.2 s Phase 2 target is expected only with P4. With the render gate (§8.5) the spike paints at ~1.9 s, so this exit needs the critical-path cuts in §8.6 item 7 first. Otherwise the user decides between the gap target and this one (§7 Q7).
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

- Raise the size cap as parsing gets cheaper. Add the content-addressed render cache (§3.2). The section boundaries and sequential gates move to stage 0 in revision 2. What is left here is P12, so sections stop parsing on the client.
- Exit: `panel18` and `large30` SSR'd under the cap. Mobile `hydrationLongestTaskMs` ≤ 50 ms on the large page: 845 / 708 ms in the first spike, ≤ 62 ms after §8.

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

- **Inert controls between paint and hydration.** The first spike measured ~0.8 s on mobile for a normal page; this is the September failure mode in a smaller form. Revision 2 addresses it with replay plus the render gate (§8). The remaining risks:
  - Input made **before** the gated first paint is dropped by the browser (§8.5).
  - The gate holds only while the entry module is evaluating synchronously, so a stray `await` before hydration silently brings the gap back. Add a test: the root-commit mark must come before FCP.
  - The replay script reads React's private `__reactProps$` expando to know a node is live. Pin it with a test per React upgrade.
- **CPU-bound renders on shared Fluid instances.** One 18-table page holds the event loop for 150–300 ms and ~290 MiB. Mitigated by the size cap, the render budget, the render cache and P12.
- **Server/client skew.** The SSR bundle and the client chunks come from one build. An HTML document cached by the CDN references its own build's chunks, which P22 keeps available.
- **Hidden mismatches.** Server snapshots convert mismatches into post-hydration re-renders: no error, but possibly a shift. The CLS gates and visual specs, not the error counter, catch these.
- **Larger documents.** HTML and payload carry the content twice: normal +9.8 KB gzip, panel18 +36 KB. Fine for normal pages; the cap covers the tail.

## 7. Open questions

1. **Inert window.** Decided 2026-11-17: input before hydration is replayed, and the paint-to-responsive gap must be under 100 ms (§8).
2. **Size cap.** Start at 64 KiB of markdown? I need the production page-size distribution (from the manifest) to know what share of loads that covers.
3. **Public CDN caching.** Should ungated SSR HTML keep `s-maxage=300, stale-while-revalidate=3600` (stale for up to an hour after a publish, then replaced in place), or should SSR documents get a shorter window? Separately: `Vary: User-Agent` on public HTML (`app-shell.ts:610`) fragments the CDN cache. Is it still needed?
4. **The snapshot's other jobs.** Deleting it loses full-tree palette search before the manifest arrives, and the instant repeat-visit paint on a flaky network. Is a 600 ms warm-load bar enough to delete it?
5. **Order against P4.** The spike shows first paint bounded by the 49 KB-gzip stylesheet. Reaching ≤ 1.2 s probably needs P4. Do P4 alongside stage 1, or accept 1.5 s as the P3 exit?
6. **Education and other routes.** Stage 1 excludes `/education`, `/search`, `/tags/*` and the special routes. Should any of them be in P3 scope, or left to P19 (prerendered marketing)?
7. **Gap against paint (revision 2).** On 1.6 Mbps, the sub-100 ms gap comes from holding first paint until the chrome is hydrated (§8.5). In the spike that put paint at ~1.9 s instead of 1.3–1.5 s. Choose one:
   - (a) Keep the gate and buy the paint back with the critical-path cuts (§8.6 item 7).
   - (b) Gate with a short deadline instead of 3 s, so slow JS paints early and replay covers the rest. The gap is then over 100 ms on the slowest loads.
   - (c) No gate. Replay alone gives 245–505 ms gaps, with nothing dropped.

   I recommend (a), with (b)'s deadline as the safety valve.
8. **Per-icon lucide imports.** A build-only transform that rewrites `import { X } from "lucide-react"` to the icon's own module saves 4,308 B of paint (138 of 142 icons leave the paint path). The price is +9.5 KiB in total, as 29 single-icon lazy chunks each with its own gzip overhead and request, plus a +3.2 KiB raise of WikiViteRoot's budget. Take it, take it with a lazy-only icons group (not yet measured), or leave it? The plugin is ready, but outside the branch.

## 8. Paint-to-responsive gap and input replay (spike revision 2, 2026-11-17)

### 8.1 The metric

**`paintToResponsiveMs`**: on the perf lab's mobile profile (390×844, DPR 3, 4× CPU, 1.6 Mbps / 750 Kbps, 150 ms RTT), a real input (CDP `Input.dispatch*`) is issued 16 ms after the article's first paint. The metric is the time from that input until the control's own effect is in the DOM. Report the median and the worst of 5 cold loads, for a normal page and the 18-table page.

- **Article paint:** Element Timing `renderTime` of the article's first paragraph (`elementtiming="article"`). It matches FCP in every gated run.
- **Probes:**
  - The mobile drawer trigger: the sheet loses `inert`. A chrome control.
  - Ctrl+K: `[role=dialog]` appears. Goes through the pre-JS shortcut queue.
- **Idle baseline:** the same probe at paint+6 s, fully hydrated and idle. It separates the control's own cost from the hydration gap.
- **Also recorded:**
  - When `hydrateRoot` is called, and when the root pass commits (a layout effect).
  - When each region hydrates: header, drawer trigger, article actions, body. The first frame whose node carries React props; polled, so an upper bound when the main thread is busy.
  - Long tasks after paint.
  - The replay log, and recoverable hydration errors.

Harness: `spike/ssr/gap.ts`, summarized by `gap-summary.py`. It serves the SSR HTML plus a client build of the same tree, gzipped, from a static server: production TTFB is not included. Clicks are scheduled from a calibration load with drift correction and land within about ±30 ms of paint; a click that landed before paint is listed as such.

### 8.2 What React 19.2.6 does with early input (read from `node_modules/react-dom/cjs/react-dom-client.development.js`)

- **Before `hydrateRoot`:** no React listener exists, so a click is lost.
- **After `hydrateRoot`, on a dehydrated boundary:** `dispatchEvent` (line 23576) tries a SyncLane hydration of the blocking boundary. If the boundary is still blocked (its lazy code is not loaded), it calls `nativeEvent.stopPropagation()` and the event is gone (line 23652). **Discrete events are not replayed.** Only continuous events (hover, focus) are queued (`queueIfContinuousEvent`).
- **Suspense boundaries hydrate later.** A dehydrated boundary met during the root pass is deferred to OffscreenLane (`workInProgress.lanes = 536870912`, line 10866) and hydrated in its own later, time-sliced render. That is what lets the chrome go live before the article body.
- **A supported way to prioritize a target exists:** `root.unstable_scheduleHydration(target)` (line 27915).
- **Updates force hydration.** An update that reaches a dehydrated boundary forces it to hydrate synchronously, so elements passed into a boundary must keep their identity (the spike memoizes the drawer tree's element).

Next.js has the same React behaviour and no pre-JS capture. Angular's jsaction is the model for what follows.

### 8.3 Replay design (`spike/ssr/replay.ts`, inlined into the head like `bootstrap/reader-shortcuts.ts`)

- **Captures** `click` and `keydown` in the capture phase on `document`, from first paint until **the target node itself** is hydrated. React sets an own `__reactProps$*` property on a host node when it hydrates it.
- **Only interactive controls** inside `#root`: `button`, `[role=button|treeitem|tab|menuitem]`, `summary`, `[data-reader-action]`.
  - **Links are never captured:** an unhydrated link navigates natively.
  - **Fields are never captured:** `input`, `textarea`, `select` and `contenteditable` type natively.
  - **Modifier chords stay with the shortcut script.**
  - **Enter and Space on a native button** are left to the browser, which turns them into a click that is then captured.
- **Deduplicates with React** by owning the event. `stopImmediatePropagation` on `document`, before React's root listeners, means React never sees it, never drops it and never handles it twice. Clicks also get `preventDefault`. The node is marked `data-ssr-pending` (an inline `cursor: progress; opacity: .55` pressed state) and `root.unstable_scheduleHydration(node)` is called.
- **Replays on every frame:** each queued event is re-dispatched (same coordinates, keys and modifiers) into the same node as soon as it is live, so React's handler runs. Events whose node was removed are dropped and logged.

Verified on the mobile profile:

| Case | Result |
| --- | --- |
| Clicks at paint, ungated | 30 of 30 replayed, 0 dropped (iterations 1, 2 and the final ungated run) |
| Ctrl+K at paint | Opened the palette in 18 of 18 gated loads (three configurations) and 6 of 6 ungated, through the existing shortcut queue. One intermediate build opened 0 of 6: my layout-effect change dispatched the open event before its listener was mounted. Fixed in iteration 8 |
| Link with the entry bundle blocked | Not prevented, not captured: native navigation to a new document (2 of 2) |
| Recoverable hydration errors | None in any run |

Not exercised in the spike: keydown replay on a focused unhydrated control, and a field typed into before hydration. No field exists in the first frame today. Both belong in the stage 1 replay spec.

### 8.4 Iterations (mobile profile; medians, worst in brackets; 5 cold loads per page unless noted)

| # | Change | Normal: paint / gap | 18-table: paint / gap | Notes |
| --- | --- | --- | --- | --- |
| 0 | First spike as is | 1496 / **click dropped** (5/5) | 1848 / **dropped** (5/5) | Chrome hydrated +595 / +790 ms after paint; 873–940 ms tasks on the 18-table page |
| 1 | + replay script | 1504 / 457 (461) | 1884 / 378 (387) | 10/10 replayed |
| 2 | + lazy article body in its own Suspense boundary (critical path 276 → 213 KiB gzip) | 1472 / 266 (286) | 1864 / 282 (299) | Re-measured with clicks within ±10 ms of paint |
| 3 | + Suspense around the sidebar and the drawer tree (memoized element) | 1504 / 238 (270) | 1844 / 272 (277) | |
| 4 | + render-blocking entry (`<script type=module blocking=render>`, top-level await on the root commit, 3 s valve) | 1744 / 78 (86) | 2024 / 166 (202) | 2 clicks landed before paint and were dropped by the browser |
| 5 | + body split into one Suspense boundary per section; body chunk starts after root commit + idle | 1732 / 75 (79) | 2048 / 175 (202) | Idle baseline: the drawer itself costs 175 ms on the 18-table page (full relayout of a 739 KB DOM) |
| 6 | + `content-visibility: auto` on sections (P14 preview) | 1736 / 81 (86) | 1812 / 52 (83) | Idle baseline 41 / 35 ms; 237–293 ms body tasks remain |
| 7 | + sequential section gates (one section hydrates per idle period) | 1740 / 47 (54) | 1816 / 64 (85) | Long tasks after paint ≤ 106 ms (typically 50–60); body hydrated +1.0 s after paint, was +1.9 s |
| — | Ctrl+K at paint, iteration 7 code (3 loads) | 282 (302) | 296 (307) | Lazy palette chunk. Preloaded in the gate: 190 / 181. Idle: 19 / 26 |
| 8 | + root pass hydrated synchronously inside the gate (`flushSync(() => hydrateRoot(…))`) + palette as a static import + shortcut queue adopted in a layout effect | **1864 / 78 (89)** | **1972 / 42 (95)** | Ctrl+K **89 (96) / 80 (91)**. Idle 45 / 37. Long tasks after paint ≤ 76 / ≤ 62 ms. Root commit lands before first paint in every run. Critical path 219.6 KiB gzip |
| — | Iteration 7 code, ungated (replay only) | 1480 / 245 (281) | 1316 / 475 (505) | 10/10 replayed. This is the price of not gating |

### 8.5 Why the gate is what closes the gap, and what it costs

- **The bandwidth floor.** Without the gate, the gap is the time for the chrome's JavaScript to arrive after the article has painted. The hydrate path needs ~165 KiB gzip of JS plus 50 KiB of CSS before the chrome can respond, and at 1.6 Mbps that is ~1 s of link. The HTML and CSS that paint the article share the same link and finish first. Iterations 2–3 cut the JS and the root-pass work, and still left 238–282 ms.
- **What the gate does.** It makes the first visible frame the hydrated one: paint waits for JS plus root hydration. On this profile that costs about +380 ms (normal) and +650 ms (18-table) of first paint against the ungated build. The 18-table page loses more because its 36 KB-gzip document competes for the link.
- **Chrome unblocks at the first `await`.** Chrome lifts the render block on a module script once its evaluation reaches the first real `await`, not when its top-level await settles. Iteration 4 painted mid-hydration, and an awaited palette import painted 150 ms **before** `hydrateRoot`. Iteration 8 therefore hydrates the root pass synchronously (`flushSync`) inside module evaluation, and anything the first frame needs must be a static import. The math and raw-HTML preloads must move behind the lazy body, which is the only place that needs them now.
- **Input before the first paint is dropped by the browser.** A render-blocked document receives no input: 4 of the 40 scheduled clicks in iterations 4–7 landed before paint and never reached the capture script. In a cold load there is nothing visible to click. On a same-origin navigation, though, the previous page stays on screen (paint holding) and taps on it are lost.
- **The safety valve:** a head timer removes the render-blocking script, which unblocks rendering per spec. It was set at 3 s; it never fired with JS present, and a stalled-bundle test is still to do. A failed fetch unblocks at once.

### 8.6 What the hydration path needs (for stage 0)

1. **The replay script** (§8.3), inlined into the head next to the shortcut script, with a unit test that pins React's `__reactProps$` marker.
2. **Chrome first.**
   - The article body in its own lazy chunk behind a Suspense boundary (`WikiPage` → `ArticleBody`). It stays as server HTML until hydrated.
   - Suspense around the desktop sidebar and the drawer tree. Elements passed into a dehydrated boundary keep their identity.
   - `MarkdownTitle` from `title-react` (already lazy) rather than `browser`.
3. **The body after the root.**
   - Its chunk starts after the root commit plus an idle period.
   - It is split into one Suspense boundary per top-level section, on server and client alike.
   - Sections hydrate one per idle period (sequential gates via `use()`).
   - Correctness gaps to close: footnotes and reference-style links across sections, duplicate heading slugs. P12 (parse at publish time) is the cleaner end state.
   - Fizz outlines large section boundaries into `$RC` scripts; set `progressiveChunkSize` if inline HTML is preferred.
4. **`content-visibility: auto` on sections** (P14). It took the drawer on the 18-table page from 175 to 35 ms idle, and paint from 2,048 to 1,812 ms.
5. **The gate.** Render-blocking entry module, root pass via `flushSync(hydrateRoot)`, first-frame code as static imports, a deadline valve. Test that the root-commit mark comes before FCP.
6. **Queued shortcuts adopted in a layout effect** (`Header.tsx`), calling `openPalette` directly. The bus listener is a passive effect and is not mounted yet. The palette chunk joins the paint set (+6.5 KiB gzip).
7. **Buying the paint back.** Each 20 KiB gzip is ~100 ms of first paint on this profile. *Corrected 2026-11-17 by A/B builds of the real app (stage 0 above):* the spike's numbers came from the spike's own chunking and overstated most items.
   - React Router's development build: ~0.5 KiB (done on main), not 14.2 KiB.
   - wiki-shell index: −4.5 KiB (done), not 20 KiB.
   - Lazy-title wrapper: nothing to save.
   - Per-icon lucide: −4.3 KiB of paint for +9.5 KiB total (open question 8).
   - `reader-startup-cache` with fflate (3.9 KiB) and `visual-phase` (4.4 KiB) are still on the paint path. The first decodes the startup snapshot for the cached first paint and goes with it in stage 3.
   - Per-surface CSS (P4): 63.3 KiB.
   - Production serves HTTP/2 with priorities; the spike's static server was HTTP/1.1.

### 8.7 Remaining blockers and limits

- **Long tasks.** They are 55–76 ms after paint, not ≤ 50 ms. What remains:
  - One section's parse and commit (~55–60 ms at 4× CPU), which P12 or smaller sections address.
  - The post-commit passive-effect flush (~60–75 ms), which could be audited per effect.
- **Paint against gap.** See open question 7.
- **Not covered by the harness:**
  - The math/raw-HTML page (`large30`) on the final configuration. Its awaited preloads would break the gate until item 5 moves them.
  - Real devices.
  - Origin TTFB.
  - The signed-in tree (session payload), which adds the account controls to the root pass.

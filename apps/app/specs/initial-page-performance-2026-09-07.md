# Initial home-page load — September 7, 2026

The reported one-to-two-second delay is reproducible on `https://diana-tnbc.com/`. Production commit `57fe635a8df512faf8f326099c9cc869dd4bcd11` took a median 1,905 ms to create the home article on a fresh desktop visit and 1,382 ms on reload. The HTML finished arriving at 218 ms and 158 ms respectively. Most of the remaining delay is browser startup, even when the network and content caches are warm.

## Concrete bug and local fix

The home page intentionally omits `WikiPageHeader`; its current markdown starts with a paragraph and has no `h1`. Three snapshot checks nevertheless required an `h1`: capture in `FirstFrameSnapshot.tsx`, TypeScript validation in `first-frame-snapshot.ts`, and the synchronous boot script in `index.html`. Consequently, the production home page never saved a first-frame snapshot. All 12 measured production loads had zero home `h1` elements and no saved first-frame snapshot.

The fix uses the rendered `.wiki-markdown` body as capture readiness. Both readers accept that body marker while retaining compatibility with older snapshots containing a title. Existing complete-manifest validation, content-hash matching, public-only persistence, sanitization, origin/version/path partitioning, and unavailable-page retirement still apply. No cache generation changes or storage resets are needed.

The new regression deliberately supplies home markdown without any heading. It first reproduced missing persistence on unchanged main, then passed with the fix. It reloads while holding every application script, verifies readable cached home content and disabled snapshot controls, and then releases scripts and verifies handoff to the live reader. Previous home fixtures included an `h1` in markdown; even the general `gotoWiki` test helper assumes one, so that helper is intentionally not used here.

This fix improves a repeat visit with a saved public home snapshot. It does not make a first visit instant, speed up full app interactivity, persist account-only content, or preserve home after another route overwrites the single snapshot slot.

## Production measurements

Chromium, 1440×1000 desktop viewport, three independent browser contexts per CPU setting, unthrottled network. Each context starts with empty code/content caches, loads `/`, and then reloads with browser and application caches intact. Login uses the normal site password endpoint. These are gate-unlocked public-reader observations, not real account-session measurements or production percentiles. No API mocks, browser routing interception, or backend writes were used for these production samples.

All times below are median milliseconds. Article means actual article DOM readiness, not the loading skeleton; FCP is measured separately and can precede the article.

| CPU / visit | HTML complete | FCP | Article ready | Navigation ready | Existing route metric |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal / first visit | 218 | 292 | 1,905 | 2,207 | 653 |
| Normal / reload | 158 | 224 | 1,382 | 1,323 | 138 |
| 4× CPU slowdown / first visit | 185 | 276 | 2,454 | 3,654 | 1,144 |
| 4× CPU slowdown / reload | 160 | 1,972 | 1,919 | 1,919 | 538 |

The slower-CPU reload FCP varied substantially (172 / 2,200 / 1,972 ms); cached resources do not guarantee an early frame when synchronous startup occupies the browser. DOM readiness is not a frame-presentation timestamp. These are small samples on the local machine, not a physical-phone benchmark. There were zero runtime errors.

Every HTML response was `Cache-Control: private, no-store` and `x-vercel-cache: MISS`. This is the current policy for password-gated HTML. Immutable JavaScript and CSS were cached correctly on reload; their zero transfer sizes demonstrate that repeatedly downloading assets is not the central problem. Increasing a public CDN TTL on gated HTML would change access behavior and would not remove database startup.

A representative cold load:

| Milestone | Time from navigation |
| --- | ---: |
| Reader-module download starts | 272 ms |
| Identity resolution starts | 577 ms |
| Identity ready | 740 ms |
| LiveStore worker requested | 1,110 ms |
| First current-page API request starts | 1,307 ms |
| Current-page response complete | 1,735 ms |
| Article rendered | 1,906 ms |

Approximately 1.11 MiB transferred before the article in that sample. The build's eager graph, including workers and SQLite, is 1,195.7 KiB gzip. Warm reloads still initialize/evaluate that machinery: in one sample the identity was ready at 679 ms and the cached body appeared at 1,383 ms, with no current-page body fetch needed.

The current `lastRouteRenderMs` timer starts inside `WikiPage`, after much of startup. A 138 ms reported warm route alongside a 1,382 ms navigation is an observability gap, not contradictory measurements. Add a navigation-origin article-visible milestone alongside the existing in-app route metric in the next performance pass.

## Local experiment: put readable HTML in the first response

`scripts/profile-initial-page.ts` compares the fixed production build with an HTML-first prototype using the same local handlers and live public backend. It captures one validated, sanitized public shell and holds it in process memory. The prototype injects that representation only into successful home HTML responses after the ordinary gate/metadata handler has run, preserving its private response headers. It does not modify production routes or store private snapshots. The cached representation adds **28,476 bytes gzip**.

Three runs per cell, alternating mode order. These are loopback results, not direct A/B speedups against the production table above. The local handler lacks production's prefetch service credential and uses live manifest enumeration; its navigation/handoff timing is therefore not equivalent to production. Readable is DOM presence; FCP and live handoff are separate measurements.

| Normal CPU | Readable DOM | FCP | Live-reader handoff |
| --- | ---: | ---: | ---: |
| Fixed code, first visit | 1,608 ms | 280 ms (loading shell) | 1,608 ms |
| Fixed code, repeat home load | 225 ms | 260 ms | 1,284 ms |
| HTML-first prototype, first visit | 306 ms | 380 ms | 4,741 ms |
| HTML-first prototype, repeat load | 201 ms | 236 ms | 1,251 ms |

At 4× CPU slowdown, the fixed repeat load had readable DOM at 293 ms and FCP at 380 ms; the HTML-first first visit had readable DOM at 345 ms and FCP at 344 ms. Raw timing precision and independently collected paint/DOM milestones can differ around a frame boundary. All 24 local cases completed without runtime errors.

The prototype establishes substantial headroom for reading, but **must not ship as implemented**. Reusing the read-only snapshot overlay keeps controls disabled until the complete manifest is ready; first-visit handoff worsened to 4.7 seconds, or 5.9 seconds with 4× CPU slowdown. Sending early HTML is useful only with a better handoff and real links that work immediately. The initial document should not wait for the full navigation manifest to become interactive.

## Recommended next steps

1. **Release the titleless-home snapshot fix.** Small, reproduced, and covered by browser tests. Expect earlier visible text on repeat public home loads, not faster full startup. The patch is local and has not been committed, pushed, or deployed.
2. **Bootstrap the current page in the authorized HTML response.** `staticIndexHtml` already retrieves the document for metadata. Reuse the authorized, redacted representation and server-issued identity, render the initial article with the existing `renderWikiMarkdownHtml` machinery, and pass the body/hash to the client so it does not request them again. Boot LiveStore in the background and reconcile it afterward. Use real anchors immediately, mount interactive controls when ready, and keep article layout stable. The small prototype shows why this is the highest-value architectural change.
3. **Cache render work behind authorization.** Store a public rendered article by site, content hash, renderer version, and redaction-policy version. Apply the current gate/access check before serving it. Treat deletion, visibility and redaction changes as invalidations. Account-only representations require a separate access model and must not enter the public cache. This saves repeated rendering without making gated responses public.
4. **Pin home plus a small bounded set of recent public snapshots.** The current key contains origin and reader generation but not pathname; every captured route replaces the previous one. Keep home available after reading another document, with a total byte budget and retirement across all retained paths. Session pages must keep their existing isolation.
5. **Make the basic reader independent of SQLite startup.** A lightweight initial article/header can consume the bootstrap payload while LiveStore, the large tree, and optional tools initialize. This targets actual usability as well as first paint. Raising cache TTLs or adding more skeletons cannot remove the remaining execution/worker cost.

A service worker that caches only the content-free shell may save part of the roughly 150–220 ms HTML leg on return visits. It is lower priority than removing a 1+ second browser dependency chain. Speculative prerendering can help following links inside the site, but not the initial address-bar visit reported here.

These rendering recommendations follow the distinction between early HTML and expensive hydration described by [Chrome's rendering guide](https://web.dev/articles/rendering-on-the-web). The access/cache separation follows the meanings of `private` and `no-store` in [MDN's Cache-Control reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control). No framework migration is required for the proposed first-page bootstrap.

## Evidence and verification

Aggregate measurements: `initial-page-performance-2026-09-07.json`. Private browser samples/screenshots stay under `.playwright/home-live/` and `.playwright/initial-page/`; they are ignored by Git. Passwords, cookies and document text are not included in the aggregate JSON. The production timing probe is retained privately at `.playwright/profile-home-live.ts`; it requires `WIKI_PERF_PASSWORD` and never saves the resulting cookie.

Run the local experiment against a production build of the fixed code:

```sh
bun apps/app/scripts/profile-initial-page.ts apps/app/dist
```

Its synthetic signed gate session is restricted to the loopback test server and never sent to production. It performs public content reads against the configured backend. The optional remote prefetch mutation and backend telemetry are disabled for the experiment.

Validation: eight focused unit tests; eleven Chromium browser tests covering home snapshot persistence/handoff, prior-cache retirement, and session-scope behavior; four WebKit browser tests covering the titleless home and cache retirement; focused ESLint, app TypeScript and production build; unchanged bundle budgets; clean whitespace check. The titleless-home browser test failed on unchanged main at missing persistence, then passed after the patch.

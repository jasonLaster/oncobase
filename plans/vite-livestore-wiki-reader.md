# Vite + LiveStore Wiki Reader Plan

Status: replacement migration branch, updated 2026-05-10. Audience: reviewer, operator, and future migration owner.

## Goal

Build the Vite + LiveStore app into the standalone replacement for the current Next `web` app: load the route shell immediately, read cached markdown from LiveStore when available, refresh manifests and page bodies in the background, and make page-to-page navigation feel instant while preserving full-stack wiki functionality.

The target end state is that `apps/wiki-vite` plus shared packages own the production app and the old `web` directory can be deleted. Until parity is complete, `web` remains a reference implementation and compatibility source, but new migration work should avoid adding durable logic there.

## Migration Status Snapshot

The migration is far enough along to use the Vite one-server path as the primary implementation target, but it is not far enough along to delete `web` yet. The strongest next move is to keep moving backend/auth/full-stack behavior into Vite and shared packages while keeping `web` only as the behavioral reference until parity and deployment checks pass.

| Area | Status | Notes |
| --- | --- | --- |
| Shared content contracts | Mostly productionized | `packages/wiki-content` owns manifest parsing, compact tree expansion, page batches, content-hash reconciliation, versioned reader cache ids, public/session store ids, PII redaction, and chat page-reading helpers. Edge-case coverage now includes invalid manifests, pagination cursors, deleted/missing hash reconciliation, store-id sanitization/versioning, redaction behavior, and chat linked-page resolution. |
| Shared markdown runtime | Mostly productionized | `packages/wiki-markdown` owns the reusable renderer, route-link adapter, heading anchors, image theater, citations, math cleanup, PDF chips, theme-paired images, smart-table behavior, and a client-safe Mermaid fallback. The extraction is useful even if Vite is not adopted; package-level server coverage now protects the highest-risk renderer transforms. |
| Backend API surface | Vite-owned path productionizing | `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages`, `/api/search`, `/api/ai-search`, `/api/chat`, `/api/tools`, and `/api/login` are served by the Vite backend. The reader API implementation now lives in `@diana-tnbc/wiki-content/server` with thin adapters, while the Vite backend also owns `/api/file`, `/api/page-copy`, and scoped markdown downloads for one-server development. Vite resolves the active site from `Host`, ignores injected `x-site-slug` headers, and now applies defense-in-depth PII redaction across page bodies, search, tools, page-copy, and downloads. |
| Convex support | Deployed additively | `documents.listManifestPage` is additive and mirrors existing document pagination without changing the publish path. Existing page and asset listing queries remain the source for markdown bodies and tree assets. The production Convex deployment now has the additive reader functions. |
| LiveStore reader | Prototype works | The Vite app persists page index, file tree, asset index, and page bodies in OPFS-backed LiveStore tables. It renders cached markdown first, fetches the manifest in the background, marks stale/deleted/missing content, eagerly fetches markdown in bounded batches, and surfaces storage pressure when browser quota is tight. |
| Reader UI parity | In progress, not cutover-ready | The current shell has a Diana-style layout, screenshot-backed desktop/mobile visual baselines, sidebar tree, mobile sheet, breadcrumbs, page actions, desktop/mobile outline, local title/slug/tag page finding, backend-powered text and AI search pages, a Vite-owned chat route with the shared full composer UI, command palette with pages/outline/assets/tags/recents/actions/debug-cache tools, sync metrics, stale indicators, not-found recovery, failed-fetch retry, and shared markdown rendering. The 2026-05-10 P0 parity pass fixed the live image-directory sidebar leak, rail-aware smart-table expansion, outline collapse participation, `/table-examples` route smoke, and bounded cold-load retry states. `packages/wiki-shell` now owns the shared right rail/outline, resizable layout, and header chrome primitives; the next extraction targets are page chrome, sidebar/mobile navigation, prose/theme CSS, and loading/empty states. |
| Privacy/cache safety | P0 guardrails covered | Public and session scopes use separate cache headers and store ids; store ids include the site slug, request origin, reader cache version, and session cache key for intentional OPFS separation. Sensitive pages stay out of public APIs, PII redaction is asserted across rendered pages/search/AI/tool/download surfaces, and browser coverage now verifies same-slug multi-site cache isolation. |
| Playwright migration | Strong but uneven coverage | `apps/wiki-vite/e2e` now mirrors every current `web/e2e/*.spec.ts` filename. Reader-capable tests run locally against mocked `/api/wiki/*` responses and include screenshot-backed visual assertions plus current-route-first network assertions. The unmocked backend API spec exercises the Vite dev backend against Convex for session, manifest, text search, live AI search, chat tool calls, live chat streaming, login, file validation, and PII-safe downloads. P0 multi-site, PII, chat-perf, sidebar collapse/resize, hidden image dirs, cold-load retry, failed-fetch retry, and rail-aware table expansion specs are active. Remaining fixture-bias risks are live-manifest smoke automation, broader visual diff gates, metadata browser placeholders, comments/Liveblocks, and deeper chat navigation-resilience cases. |
| Deployment | Isolated Vercel project live | `diana-tnbc-wiki-vite` is a separate Vercel project connected to the same Git repo, with SSO deployment protection disabled for smoke testing and env scoped to the new project. Root `vercel.json` builds `apps/wiki-vite`, serves `apps/wiki-vite/dist`, and routes `/api/*` plus app shells through Vercel Functions that share the same request handler as the standalone Bun server. The stable production URL is `https://wiki-vite-zeta.vercel.app`; preview and production smokes now verify session API, route password gate, bot metadata, and browser render. Remaining work is custom-domain cutover, rollback runbook, and CI automation for the preview smoke. |
| Migration decision | Direction set | Vite is the intended replacement. Keep `web` only until auth, multi-site, metadata, full-stack features, cache policy, UI parity, and E2E coverage are good enough to delete it. |

## Work Log

### 2026-05-10 Wiki Header Extraction Checkpoint

Implementation follow-up from the shell extraction:

- Added shared `WikiHeader`, `WikiHeaderSearchForm`, `WikiHeaderButton`, `WikiHeaderLink`, and `WikiLogo` primitives to `packages/wiki-shell`.
- Replaced the Vite-only header implementation with the shared header chrome while keeping Vite-specific routing, backend search submission, chat links, and command-palette actions as host-owned adapters.
- Moved local page finding out of the primary header search and into the command palette. The header search now targets the backend `/search` page, matching the replacement decision that canonical text and AI search stay backend-owned.
- Removed the dead Vite-only topbar/search CSS now covered by package-owned shell styles.
- Updated Playwright coverage for backend search submission, chat handoff, local page finding, session/public store separation, and desktop visual parity assertions.

Verification:

```sh
bun --cwd packages/wiki-shell typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite test:e2e e2e/search.spec.ts e2e/chat.spec.ts e2e/session-recovery.spec.ts --reporter=line
bun --cwd apps/wiki-vite test:e2e e2e/visual-parity.spec.ts --reporter=line
```

Full verification result: `bun run verify:wiki-vite` passed with `112 passed`, `50 skipped`.

### 2026-05-10 Wiki Shell Extraction Checkpoint

Implementation follow-up from the visual reuse audit:

- Added `packages/wiki-shell` as the first reusable shell package. It now exports `DocumentOutlineShell`, the shared outline helpers, persisted right-rail pane state, the current app's `comments-pane-state-change` event contract, `ResizableLayout`, and package-owned shell CSS.
- Replaced Vite's bespoke `PageOutline` implementation with `DocumentOutlineShell`. The Vite reader now uses the current app's collapsed-by-default desktop outline rail, expandable/resizable right rail, mobile bottom outline rail, and `comments-content-wrapper` CSS variable contract.
- Replaced the Vite-only resizable app shell internals with the shared `ResizableLayout` export while keeping the Vite wrapper import path stable.
- Updated the smart-table layout adapter to measure the shared `comments-content-wrapper` and listen to the shared right-rail pane event, so expanded tables stay between the left rail and right outline rail as the rail opens, collapses, or resizes.
- Updated focused Playwright coverage for collapsed-default outline behavior, mobile outline expansion, rail-aware table expansion, and refreshed the Vite visual baselines for the new shell shape.

Verification:

```sh
bun --cwd packages/wiki-shell typecheck
bun --cwd packages/wiki-shell test:unit
bun run verify:wiki-vite
```

### 2026-05-10 Visual Component Reuse Audit Checkpoint

Side-by-side browser review of Vite and the current Next app on `/wiki/logistics/insurance` and `/about/Terminology` showed that the Vite replacement is functionally broad but visually too independent. The most important finding is that parity should come from reusing the original shell components, not from continuing to tune Vite-only CSS.

- The right rail is the clearest extraction target. `web/src/components/document-comments.tsx` already contains an outline-only `OutlineShell`, collapsed rail controls, persisted pane width/open state, desktop fixed rail behavior, and mobile rail behavior. Vite currently has a separate `apps/wiki-vite/src/pages/PageOutline.tsx` implementation, so it misses the current app's collapsed-default rail semantics and right-rail layout contract.
- Header and page chrome should be adapterized. `web/src/components/header.tsx`, `actions-menu.tsx`, `copy-page-button.tsx`, and the document page header shape match the Diana site more closely than the Vite `Header.tsx` plus page action strip. Vite should keep its backend/local data affordances, but present them through the current header/action-menu shape.
- The sidebar and bottom navigation are close enough to extract. `web/src/components/sidebar.tsx`, `bottom-nav.tsx`, and `resizable-layout.tsx` should become router-adapted shell components. Vite can keep LiveStore data, local expansion persistence, and React Router navigation through adapters.
- Typography and theme drift are a package problem. The current app's `.dark` tokens, `.prose` rhythm, smart-table styling, media handling, and Liveblocks/right-rail CSS live in `web/src/app/globals.css`; Vite has a separate light-first `styles.css`. Shared prose/theme CSS should move with the shell/markdown packages so both apps render the same page body.
- Search, chat, command palette, loading, and empty states still need visual reuse after the main reader shell lands. Their backend ownership can stay in Vite, but row styles, action menus, focus states, and mobile overflow should follow the existing app.

The recommended package shape is `packages/wiki-shell`: framework-neutral React shell components plus CSS variables/classes, with adapters for routing, links, scroll, copy/download actions, theme state, and data sources. Comments and Liveblocks can stay parked, but the right rail should not be parked because outline behavior and expanded-table bounds depend on it.

### 2026-05-10 Log Rendering Fidelity Checkpoint

Follow-up from the live `/about/Log` rendering report:

- Compared the canonical vault file at `/Users/jasonlaster/src/projects/diana-tnbc/obsidian/about/Log.md` against the local Vite API. The page API now matches the disk source exactly after the expected PII redaction pass: `docHash=fb6bc1485b03a208`, `apiHash=fb6bc1485b03a208`, `exactAfterRedaction=true`, with both the newest `Saturday, May 9th` entry and the final `Friday, March 13th` biopsy entry present.
- Updated just `about/Log` through the additive publish document endpoint after finding the backend content was stale relative to disk. The issue was not markdown truncation: the stale backend body still rendered through the tail, but it missed the newest top-of-log entries.
- Fixed the replacement reader client to revalidate browser HTTP cache for wiki session, manifest, and page-body requests by default. This keeps a warmed LiveStore page from being incorrectly considered fresh when the backend has already published a newer hash.
- Added Playwright coverage that renders a Log-sized markdown body and asserts top, middle, and tail sentinels survive the manifest, LiveStore, markdown renderer, and page chrome path.

### 2026-05-10 P0 Parity Audit Checkpoint

Audit goal: stop treating "roughly works" as parity and build a launch-blocking checklist from the old specs, old Playwright tests, migrated Vite tests, and real browser behavior.

Sources reviewed:

- Spec docs: `web/specs/table-expansion.md`, `web/specs/table-expansion-testing.md`, `web/specs/table-expansion-qa.md`, `web/specs/comments.md`, `web/specs/features.md`, `web/specs/page-rendering-caching.md`, `web/specs/multi-site.md`, and `web/specs/pii-redaction.md`.
- Reference tests: the current `web/e2e/*.spec.ts` suite, especially `table-expansion.spec.ts`, `comments.spec.ts`, `navigation.spec.ts`, `sidebar-pdfs.spec.ts`, `metadata.spec.ts`, and `chat-nav-resilience.spec.ts`.
- Replacement tests: `apps/wiki-vite/e2e/*.spec.ts`, including skipped-in-place specs and fixture-heavy tests.
- Browser checks: the in-app browser on `http://127.0.0.1:60001/wiki/logistics/insurance`, `http://127.0.0.1:60001/about/Terminology`, and `http://127.0.0.1:60001/table-examples`; a clean headless browser against the same local dev server; and direct local API probes against `/api/wiki/manifest`.

Concrete failures found:

- Real-data sidebar filtering is not complete. The fixture test for hiding image directories passes, but the in-app browser on `/wiki/logistics/insurance` still showed `images` directories under the live tree. This likely means the backend manifest path, persisted LiveStore cache, or cache-version migration is still surfacing image-only directories.
- Expanded smart tables are not rail-aware. On `/about/Terminology`, the page had 20 smart table shells and 20 expand controls, but expanding the first table visually placed the expanded surface over the left navigation rail instead of inside the lane between the left rail and right outline rail. This violates the table expansion spec's central contract.
- Right sidebar parity is incomplete. Vite has a basic outline surface, but the current app's right rail responsibilities include outline/comments mode, collapse, resize, mobile behavior, and table-lane coordination. The missing right rail behavior is not just a comments backlog item; it affects table geometry and reading layout.
- `/table-examples` is not a real Vite route under live data. The Vite tests can exercise table fixtures, but the real local route stays at a loading state, so the suite can miss app-route parity gaps.
- Clean cold loads can stall while warm caches look fine. A clean headless browser at `/wiki/logistics/insurance`, `/wiki/people/medical-team`, and `/about/Terminology` rendered the shell but remained at "Loading markdown..." while the warmed in-app browser could show cached content. Server logs showed repeated Convex manifest errors followed by fallback attempts, and a direct `/api/wiki/manifest?scope=public` probe hung long enough to block route hydration. This needs a timeout, circuit breaker, fallback response, and visible retry/error path.
- Metadata and chat resilience are still partly papered over by skipped specs or standalone-only smoke checks. That is acceptable as inventory, but not as replacement evidence.

Immediate conclusion: the replacement path is viable, but the next work should be a parity-hardening sprint rather than more feature expansion. The priority order is table/right-rail geometry, live-manifest/sidebar correctness, cold-load/backend fallback reliability, and then promotion of skipped parity specs into active tests.

### 2026-05-10 P0 Parity Fix Checkpoint

Follow-up fixes from the audit:

- Hid image-only directories from the live reader tree end to end. `packages/wiki-content` now filters hidden page slugs, literal `images` asset paths, and image-file assets in folders like `*-images`; the server manifest builder uses the same predicates; and the reader cache version moved to `reader-v2` so old OPFS trees with stale image nodes are naturally isolated from the replacement store. Image assets remain in the manifest asset index for markdown rendering and file actions.
- Deployed the additive Convex backend change that stores `documents.sizeBytes` and lets `documents.listManifestPage` build manifest page metadata without returning full markdown bodies. This keeps the manifest path additive while reducing the amount of content Convex has to move for reader metadata.
- Added client and server request bounds for manifest/page fetches. The shared client now aborts stalled wiki requests, the server manifest generation is timeout-wrapped, and the Vite page shell renders a deterministic retry/error state instead of staying on "Loading markdown..." forever when the manifest path fails.
- Made expanded smart tables layout-aware in the Vite reader. The shared markdown renderer accepts a table layout adapter, and the Vite adapter computes the expanded lane from the visible left rail, page content bounds, and right outline rail. It updates on sidebar collapse/resize, outline collapse, scroll, resize, and DOM mutations.
- Promoted the outline rail into the layout contract with a persisted collapse control. Comments remain backlog, but outline state now affects table expansion and article width instead of being a passive decoration.
- Added a real `/table-examples` Vite route that lazy-loads the shared smart-table examples, so table route smoke tests no longer rely only on synthetic fixture markdown.

Verification for this pass:

- `bun --cwd packages/wiki-content test:unit`
- `bun --cwd packages/wiki-markdown typecheck`
- `bun --cwd apps/wiki-vite typecheck`
- `bun --cwd web test:unit src/lib/wiki-api-routes.test.ts`
- `bun --cwd apps/wiki-vite test:e2e e2e/navigation.spec.ts e2e/page-load-experience.spec.ts`
- `bun --cwd apps/wiki-vite test:e2e e2e/table-expansion.spec.ts`
- `bun --cwd apps/wiki-vite build`
- `bun --cwd apps/wiki-vite check:bundle`
- `bun --cwd apps/wiki-vite verify:standalone`
- `bun --cwd apps/wiki-vite test:e2e` (`111 passed`, `50 skipped`)
- Live manifest probe on `http://127.0.0.1:60001/api/wiki/manifest?scope=public` confirmed `4722` pages, `10501` assets, `0` hidden image-dir nav hits, `0` image-file nav hits, and `81055297` total page-size bytes.
- In-app browser smoke on `http://127.0.0.1:60001/wiki/logistics/insurance` confirmed no body/sidebar `images` or image-extension matches and no loading shell; `/about/Terminology` expanded a smart table successfully.

Remaining P0 risk after this pass: metadata placeholder cleanup, seeded non-Diana live multi-site testing, deeper chat navigation resilience, right-rail resize parity, comments/Liveblocks backlog decision, and broader visual diff gates against the current app.

### 2026-05-10 Isolated Vercel Project Checkpoint

- Created and connected a separate Vercel project, `diana-tnbc-wiki-vite`, so the Vite replacement can be deployed and tested independently of the existing `diana-tnbc` Next project.
- Added root Vercel deployment config for the standalone replacement path. The existing Next project has Vercel root directory `web`, so the root config is for the isolated Vite project and does not reroute the current production app.
- Added Vercel Functions for `/api/*` and route-shell HTML. They call the same shared Vite request handler used by the Bun standalone server, preserving password-gate enforcement, bot metadata rendering, full-stack API routes, and private/public cache behavior.
- Kept the app-local Vercel config in `apps/wiki-vite/vercel.json` for subdirectory CLI builds, but the connected Git project uses the root config so workspace packages and `web/convex` generated APIs are available.
- Copied the required Convex and AI env vars from the local Vite env into the isolated project for production, development, and the current preview branch. `WIKI_SITE_SLUG=diana` pins the new `vercel.app` host to the Diana site until the host is added to site records.
- Disabled Vercel SSO deployment protection on the isolated project so unauthenticated smoke tests reach the app's own password gate instead of Vercel's auth wall.
- Deployed production to `https://wiki-vite-zeta.vercel.app`.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-content typecheck
bun --cwd packages/chat typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite verify:standalone
vercel build --yes
vercel deploy --prebuilt --yes
vercel build --prod --yes
vercel deploy --prebuilt --prod --yes
PLAYWRIGHT_BASE_URL=https://wiki-vite-zeta.vercel.app WIKI_VITE_SMOKE_PATH=/wiki/logistics/insurance WIKI_VITE_SMOKE_COOKIE=<auth-cookie> bun --cwd apps/wiki-vite test:e2e:preview
```

Production smoke result: `/api/wiki/session` returns `diana:public`, `/wiki/logistics/insurance` redirects unauthenticated users to `/login`, link-preview bot requests receive page-specific canonical/OG metadata, and Playwright preview smoke passed.

### 2026-05-10 Production Chrome Parity Checkpoint

- Removed prototype diagnostics from the default reader chrome. Metrics, sync queue status, scope switching, LiveStore cache controls, and the LiveStore inspector link no longer render in the header, article column, or footer by default.
- Moved those diagnostics into the optional LiveStore footer, visible only when the route includes `?devtools=1` or `?livestoreDevtools=1`.
- Kept the browser observability buffer active while hiding the visual metrics panel, so Playwright and performance checks can still read `window.__WIKI_VITE_OBSERVABILITY__` without exposing prototype UI in production.
- Updated Playwright coverage so production-like pages assert that diagnostics are hidden by default, while `?devtools=1` still exposes scope/store-id isolation, storage pressure, warm-cache, reset-cache, and LiveStore inspector controls.
- Raised the standalone Bun server `idleTimeout` to 60 seconds after the preview smoke exposed cold manifest fallback requests exceeding Bun's default 10 second timeout.
- Made the live AI-ranking smoke explicitly opt-in with `WIKI_VITE_RUN_LIVE_AI_SEARCH=1`; normal local verification still covers the AI route contract, mocked ranked results, search/chat PII redaction, and host/site isolation without depending on the external Convex vector-ranking path.
- Verification command run for this checkpoint:

```sh
bun run verify:wiki-vite
bun run verify:wiki-vite:server
```

Result: `verify:wiki-vite` passed with `105 passed, 50 skipped`; `verify:wiki-vite:server` passed with the standalone route gate, metadata, API, and preview smoke checks.

### 2026-05-10 Reader Detail Parity Checkpoint

- Tightened page breadcrumbs from loose path text into an accessible breadcrumb list. The current page now uses the manifest title and `aria-current="page"`, and ancestor crumbs link only when the target slug exists in the local page index.
- Ported the current web shell's desktop sidebar affordances into Vite: the left rail can collapse to an icon-only rail, expand back to the stored width, resize by dragging the rail handle, and persist width through reloads.
- Fixed file-tree collapse semantics so an active branch opens by default but a user can still collapse it intentionally; that preference now persists across reloads instead of being overridden by the active route.
- Moved hidden file-tree path handling into `packages/wiki-content` so `images` directories and image-only assets stay out of the sidebar tree while still remaining available through markdown rendering, source links, and the asset palette.
- Pulled Vite markdown typography closer to the current web prose styles for h4, links, code/pre surfaces, horizontal rules, and strong text.
- Expanded regression coverage:
  - `packages/wiki-content` now tests hidden image-directory filtering.
  - `navigation.spec.ts` now covers active-branch collapse persistence, hidden image asset directories, asset-palette preservation, and sidebar collapse/resize persistence.
  - `page-chrome.spec.ts` now checks breadcrumb links/current-page semantics.
  - Desktop visual parity snapshot was refreshed for the now-visible resize rail.
- Focused verification:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/navigation.spec.ts e2e/page-chrome.spec.ts e2e/sidebar-pdfs.spec.ts e2e/page-load-experience.spec.ts e2e/visual-parity.spec.ts
```

Focused result: wiki-content `17 passed`; Vite typecheck passed; focused Playwright `28 passed`.

Full verification result: `bun run verify:wiki-vite` passed with `108 passed, 50 skipped`; `bun run verify:wiki-vite:server` passed with the standalone route gate, metadata/API checks, and preview smoke.

### 2026-05-09 P0 Replacement Blockers Checkpoint

- Hardened site isolation for the Vite replacement path. Chat now passes the active `siteSlug` through the shared chat runtime into client-side Convex list/get/create/send/archive/streaming mutations, and the Vite backend keeps resolving sites from `Host` instead of request-injected headers.
- Added defense-in-depth PII redaction to Vite backend reads. `/api/wiki/pages`, `/api/search`, `/api/tools`, `/api/page-copy`, `/api/download`, `/api/ai-search`, and `/api/chat` now share site-aware redaction behavior, while Diana keeps its fallback patterns and non-Diana sites use configured site patterns or inline redaction blocks only.
- Hardened minimal metadata SSR in the standalone Bun server. Normal unauthenticated browser requests stay password-gated, link-preview bots can receive metadata-only HTML without a login cookie, canonical/OG tags are injected, bot HTML uses public cache headers, and authenticated HTML uses private no-store headers.
- Made the LiveStore footer expose the full `data-store-id` so browser tests can assert site/session cache separation without depending on truncated UI text.
- Activated P0 Playwright coverage for multi-site isolation, PII parity, and chat perf. Metadata hardening is currently verified by the standalone smoke because the normal Playwright dev server intentionally does not own production HTML patching.
- Verification command run for this checkpoint:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd packages/chat typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/pii-redaction.spec.ts e2e/multi-site-isolation.spec.ts e2e/chat-perf.spec.ts e2e/backend-api.spec.ts
bun run verify:wiki-vite
bun run verify:wiki-vite:server
```

Focused P0 result: `32 passed`. Full Vite suite result after this checkpoint: `105 passed, 49 skipped`. Standalone server verifier passed, including password gate, bot metadata, authenticated metadata, backend API smokes, and preview smoke.

### 2026-05-09 P1 Parity And Polish Checkpoint

- Polished auth/session UX: session recovery now sends users to `/login` with a hash-preserving `redirect`, the login page displays the return target, and scope switching preserves both query string and hash.
- Made downloads/file actions more standalone in the Vite backend: `/api/page-copy` returns scoped markdown with download headers, `/api/file` reports public/session cache scope, and `/api/download?type=full` can stream the current scoped wiki as a markdown bundle for the standalone app.
- Improved search and AI-search UX: results keep native links, support keyboard selection with arrow keys and Enter, show tag context, and record search timing/result metrics in the client observability buffer.
- Improved palette/sidebar accessibility: palette modes remain native segmented buttons with pressed state, palette results keep keyboard highlighting, sidebar links expose `aria-current`, directories expose `aria-expanded`, and the mobile sheet has dialog semantics.
- Added a small client observability surface at `window.__WIKI_VITE_OBSERVABILITY__` plus a metrics panel test hook so preview smoke can inspect route metrics and search timings without scraping visible text.
- Verification command run for this checkpoint:

```sh
bun --cwd apps/wiki-vite test:e2e e2e/session-recovery.spec.ts e2e/page-chrome.spec.ts e2e/search.spec.ts e2e/command-palette.spec.ts e2e/navigation.spec.ts e2e/page-load-experience.spec.ts e2e/backend-api.spec.ts
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite verify:standalone
bun --cwd apps/wiki-vite test:e2e
```

Focused result: `57 passed`. Full Vite suite result after this checkpoint: `86 passed, 68 skipped`.

### 2026-05-09 Migration Backlog Deepening Checkpoint

- Split the remaining migration inventory into P0 replacement blockers, P1 parity/polish, and parked backlog.
- Marked comments, Liveblocks, and comment API migration as parked backlog rather than standalone replacement blockers.
- Expanded the P0 backlog for metadata hardening, multi-site isolation, PII parity, chat resilience/perf, and deployment/ops with concrete acceptance criteria.
- Updated skipped Playwright spec names so the suite output now distinguishes P0 blockers from parked comments/Liveblocks backlog.
- Added explicit skipped acceptance placeholders for canonical/OG metadata, metadata cache headers, site-scoped LiveStore caches, site-scoped AI/chat citations, AI/chat PII redaction, failed-stream chat recovery, and chat timing instrumentation.
- Verification command run for this checkpoint:

```sh
bun --cwd apps/wiki-vite test:e2e
```

Latest result: `80 passed, 68 skipped` for the Vite Playwright suite. The increased skip count comes from newly explicit backlog acceptance placeholders, not from new failing behavior.

### 2026-05-09 Full-Stack E2E Hardening Checkpoint

- Copied the required local test credentials into the ignored `apps/wiki-vite/.env.local` and added a Playwright-only env loader so the Node test runner sees the same Convex and model credentials as the Vite app.
- Expanded the unmocked backend API coverage to prove live AI search ranking, invalid chat body validation, and a real streamed `/api/chat` response from the Vite backend.
- Expanded the chat UI coverage to send a live prompt through the shared full composer, wait for the streamed assistant answer, assert the `/chat/:id` route, and archive the created Convex conversation during cleanup.
- Moved Tailwind to theme/utilities-only imports in the Vite app. This keeps the shared chat utility classes available while preventing Tailwind preflight from changing the wiki reader's established visual baseline.
- Re-ran the high-value full-stack slice, the full migrated Vite Playwright suite, typecheck, production build, bundle budget, and standalone server verifier.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite test:e2e e2e/backend-api.spec.ts --grep "AI search rankings|chat API"
bun --cwd apps/wiki-vite test:e2e e2e/chat.spec.ts --grep "can send"
bun --cwd apps/wiki-vite test:e2e e2e/backend-api.spec.ts e2e/chat.spec.ts e2e/search.spec.ts
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite verify:standalone
bun --cwd apps/wiki-vite test:e2e
bun run verify:wiki-vite
```

Checkpoint result before the backlog placeholders were expanded: `80 passed, 62 skipped` for the Vite Playwright suite. The skipped tests were the explicit migration inventory for comments/Liveblocks, metadata hardening, multi-site isolation, PII redaction parity, and a few future chat resilience/performance flows.

### 2026-05-09 Password Gate and AI Search Checkpoint

- Enforced the password gate in the standalone Vite server for app routes before serving the built shell. Asset and API requests remain outside the shell gate, `/login` can render when needed, authenticated users can render the reader, and magic-token links redirect through `/api/login` with the token stripped from the final route.
- Updated the standalone verifier so it proves both unauthenticated redirect behavior and authenticated shell rendering before running the preview smoke.
- Added Vite `/api/ai-search` as a backend-owned route. It merges backend text-search candidates with optional OpenAI embedding/vector-search candidates, scopes reads by Host-resolved site and session sensitivity, redacts configured PII before scoring, and uses AI SDK structured output for relevance summaries.
- Added an AI mode to the Vite `/search` page. Text search remains the default; AI mode posts the text-search slugs to `/api/ai-search`, shows ranking/error states, and links results back into the reader.
- Extended Convex `documents.vectorSearch` additively with an `includeSensitive` flag so authenticated AI search can use the same privacy boundary as direct document reads.
- Activated Vite AI-search Playwright coverage and added unmocked backend route validation that does not require model credentials.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e --grep "AI mode|search route"
bun --cwd apps/wiki-vite test:e2e e2e/backend-api.spec.ts --grep "AI search|text search"
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite verify:standalone
```

### 2026-05-09 Vite Chat Route Checkpoint

- Added Vite `/api/chat` route ownership using the existing AI SDK streaming pattern, Convex conversation flusher, wiki search/read/list tools, system-prompt cache, optional OpenAI semantic search, and Host-resolved site scope.
- Mounted a Vite `/chat` and `/chat/:id` UI that reuses `@diana-tnbc/chat`'s full `ChatInterface` composer/message runtime with a Vite Convex provider, React Router links, and shared wiki markdown rendering.
- Made `@diana-tnbc/chat` less Next-bound by adding a runtime `LinkComponent` adapter for source links, keeping the current Next app on `next/link` while letting Vite use React Router.
- Added Tailwind v4 compilation to the Vite app with `packages/chat/src` as a source so the shared chat UI utilities render correctly in the replacement app.
- Added a lazy `ChatPage` bundle budget so the full chat surface is tracked separately from the reader entry bundle.
- Added Vite Playwright coverage for chat route loading, header-to-chat navigation, and `/api/chat` backend ownership. Live send/stream remains skipped locally unless AI Gateway credentials are present.
- Re-deployed the additive Convex backend to `https://youthful-cricket-560.convex.cloud` after extending `documents.vectorSearch` with `includeSensitive`, so the local Vite server and deployed functions agree on the chat/AI-search call shape.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/chat typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/backend-api.spec.ts --grep "full chat API"
bun --cwd apps/wiki-vite test:e2e e2e/chat.spec.ts
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite verify:standalone
bunx convex deploy --env-file .env.local --typecheck try
```

### 2026-05-09 Vite Backend Search/API Checkpoint

- Added a Vite `/api/search` backend route backed by the existing Convex document search query.
- Added a Vite `/api/tools` backend route for the existing chat tool surface: `search_wiki`, `read_page`, `list_pages`, `get_pages_by_tag`, and `list_tags`.
- Added a Vite `/api/login` route plus a minimal React `/login` page so the replacement app owns the login endpoint and UI surface instead of relying on Next.
- Added a Vite `/search` page backed by the Vite `/api/search` route, so canonical text search is no longer only a handoff in the replacement app.
- Added minimal standalone metadata injection: the Bun server patches built Vite HTML with public page title, description, and OG tags for route shells.
- Fixed the Vite dev middleware request adapter to preserve POST request bodies, which protects current and future Vite backend routes from empty JSON payloads.
- Moved framework-neutral PII redaction and chat page-reading logic into `@diana-tnbc/wiki-content`, leaving `web` with thin compatibility wrappers and Vite with a package import instead of reaching into `web/src`.
- Switched Vite backend site resolution from trusting `x-site-slug` to resolving from `Host`, with local-dev and preview fallbacks. The backend now rejects unknown hosts and covers header-injection behavior in Playwright.
- Preserved the v1 product direction: the Vite reader still treats search as a backend-owned full-stack surface, but the one-server Vite backend can now serve the underlying API for parity and future UI integration.
- Added public/session cache-scope headers to the shared session API responses so Vite backend tests can assert the same privacy boundary as the Next adapters.
- Added unmocked Playwright backend API coverage for `/api/wiki/session`, `/api/wiki/manifest`, `/api/search`, `/api/tools`, `/api/login`, and `/api/file` error handling.
- Extended the standalone one-process verifier to smoke `/api/search`, `/api/tools`, `/api/login`, and `/api/file` validation in addition to the built shell and session API.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd packages/wiki-content typecheck
bun --cwd web test:unit src/lib/pii-redaction.test.ts src/lib/chat-page-reader.test.ts
bun --cwd web typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/backend-api.spec.ts
bun --cwd apps/wiki-vite test:e2e e2e/backend-api.spec.ts e2e/sidebar-pdfs.spec.ts
bun run verify:wiki-vite:server
bun run verify:wiki-vite
```

### 2026-05-09 Root Verification Script Checkpoint

- Added root `bun run verify:wiki-vite` as the one-command local proof for the migration branch.
- The script runs shared content tests, shared markdown tests, Vite typecheck/build, the Vite bundle budget, and the migrated Vite Playwright suite.
- Local result after the backend API checkpoint: shared content `16 passed`, shared markdown `21 passed`, and Vite Playwright `71 passed, 68 skipped`.
- Added `bun run verify:wiki-vite:server` for the one-process server path. It builds `apps/wiki-vite`, starts the standalone Bun server, smokes the built shell and wiki session API, runs the preview smoke against that origin, and shuts the server down.
- Local standalone result after the backend API checkpoint: backend session/search/tools/login/file smokes passed, plus preview smoke `1 passed`.
- Verification command for this checkpoint:

```sh
bun run verify:wiki-vite
bun run verify:wiki-vite:server
```

### 2026-05-09 Client Mermaid Fallback Checkpoint

- Added a client-safe Mermaid fallback in `packages/wiki-markdown` for fenced Mermaid blocks. It renders the diagram title, task rows for simple Gantt diagrams, and collapsible source without adding a heavy browser Mermaid renderer.
- Added package-level client renderer coverage for the Mermaid fallback and route-link adapter boundaries so the behavior is protected below the Vite adapter.
- Activated the Vite timeline Gantt Playwright test that had been skipped as a markdown parity gap.
- Re-activated the command-palette source-boundary Playwright test now that Vite owns local palette navigation.
- Re-ran package markdown checks, the Vite production build, bundle budget, focused timeline/source-boundary coverage, and the full Vite Playwright migration suite: `61 passed, 70 skipped`.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-markdown typecheck
bun --cwd packages/wiki-markdown test:unit
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/timeline-gantt.spec.ts
bun --cwd apps/wiki-vite test:e2e e2e/source-loading-boundary.spec.ts
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite test:e2e
```

### 2026-05-09 Storage Pressure Checkpoint

- Added browser storage quota tracking to the reader metrics path. The metrics panel now shows cache pressure when `navigator.storage.estimate()` reports warning or critical usage.
- Kept OPFS-compatible testing by stubbing only `estimate()` while preserving `getDirectory()`, `persist()`, and `persisted()` for LiveStore.
- Added a current-route-first network assertion so cold deep links fetch the visible page body before eager markdown cache warming.
- Re-ran the production build, bundle budget check, focused page-load coverage, and full Vite Playwright migration suite: `59 passed, 72 skipped`.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-load-experience.spec.ts
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite test:e2e
```

### 2026-05-09 Versioned Cache Invalidation Checkpoint

- Added `WIKI_READER_CACHE_VERSION` to `packages/wiki-content` and included it in `makeWikiStoreId`.
- Future schema or reader cache changes can intentionally open a fresh OPFS-backed LiveStore cache by bumping the shared reader cache version.
- Added contract coverage for reader cache-version separation and re-ran browser session recovery coverage to preserve public/session/cache-key isolation.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd packages/wiki-content typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/session-recovery.spec.ts
```

### 2026-05-09 Debug Palette Checkpoint

- Added a Debug mode to the command palette for keyboard-discoverable local cache operations.
- The palette now exposes warm local markdown cache, reset local cache, and LiveStore devtools toggle actions without requiring the optional footer to be opened.
- Added focused Playwright coverage for the Debug palette and warm-cache action.
- Re-ran the production build, bundle budget check, and full Vite Playwright migration suite: `57 passed, 72 skipped`.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/command-palette.spec.ts
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite test:e2e
```

### 2026-05-09 Reader Recovery Checkpoint

- Added explicit not-found handling for deep links that are absent from the latest manifest instead of leaving the reader in a permanent markdown-loading state.
- Added a current-page markdown fetch failure shell with a local retry action. The retry path reuses the existing LiveStore fetch path and does not fetch server-rendered HTML.
- Updated the old scope-pill Playwright assertion to match the route-preserving public/session scope switcher.
- Re-ran the full migrated Vite Playwright suite after adding the recovery coverage.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-load-experience.spec.ts e2e/navigation.spec.ts
bun --cwd apps/wiki-vite test:e2e
```

Latest result: `47 passed, 72 skipped` for the Vite Playwright suite.

### 2026-05-09 Local Palette Checkpoint

- Added local tag and recent-page modes to the command palette. Tag selection filters the local page index, and recent pages come from the same local recency list used by reader navigation.
- Kept canonical text search, AI search, and chat on the backend/full-stack surfaces for v1; the palette continues to expose those as handoff actions rather than local clones.
- Added Playwright coverage for tag filtering and recent-page navigation from the local palette.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/command-palette.spec.ts e2e/search.spec.ts
bun --cwd apps/wiki-vite test:e2e
```

Latest result: `50 passed, 72 skipped` for the Vite Playwright suite.

### 2026-05-09 Deployment Wiring Checkpoint

- Added explicit Vite environment documentation for `VITE_WIKI_API_ORIGIN` and `VITE_WIKI_APP_ORIGIN`, including the difference between API fetches and backend-owned UI handoffs.
- Updated the Vite content client calls to use the configured API origin and `credentials: include` when running against a separate backend origin.
- Added allowlist-based credentialed CORS support to the additive Next wiki APIs through `WIKI_VITE_ALLOWED_ORIGINS`. Unlisted origins receive no CORS headers and preflight with `403`.
- Added an optional Vite preview smoke Playwright config and script. It runs against `PLAYWRIGHT_BASE_URL` without local mocks or a local web server.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd packages/wiki-content typecheck
bun --cwd web test:unit src/lib/wiki-api-routes.test.ts
bun --cwd apps/wiki-vite typecheck
```

### 2026-05-09 Cache Isolation Checkpoint

- Added browser-level Vite coverage for public/session LiveStore separation. The test loads a sensitive session-only page, switches to the public scope, verifies a different store id, and confirms the sensitive body/search result is not visible.
- Re-ran focused session/search coverage and the full migrated Vite Playwright suite.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/session-recovery.spec.ts e2e/search.spec.ts
bun --cwd apps/wiki-vite test:e2e
```

Latest result: `50 passed, 72 skipped` for the Vite Playwright suite.

### 2026-05-09 Vite Backend Direction

The two-dev-server setup is useful for proving the reader while the current Next app owns production routes, but it should not be the long-term local development loop. The backend work should split into a framework-neutral wiki API core plus thin adapters:

- Shared core: manifest/page/session handlers that take a request-like object, site scope, session resolver, and document gateway.
- Next adapter: keeps the existing additive `/api/wiki/*` production routes.
- Vite adapter: serves the same `/api/wiki/*` routes from the Vite dev server and, if we choose, a Vite preview/backend deployment.
- Backend-owned full-stack features: search, AI search, chat, comments, downloads, and auth pages can remain in Next for v1 and be linked to from Vite until explicitly moved.

This lets `bun run dev:wiki-vite` become the normal prototype loop without requiring a second Next dev server, while preserving the current production app as the source of truth.

### 2026-05-09 Vite Backend Adapter Checkpoint

- Moved the manifest/pages/session implementation into `@diana-tnbc/wiki-content/server` so the backend logic is no longer tied to Next route handlers.
- Reduced the Next `/api/wiki/*` routes to thin adapters that provide site data, session lookup, and CORS decoration.
- Added a Vite dev middleware adapter. When `VITE_WIKI_API_ORIGIN` is unset, the Vite server now serves `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages`, `/api/file`, and `/api/page-copy` directly against Convex. Setting `VITE_WIKI_API_ORIGIN` still proxies `/api/*` to the current Next app for comparison.
- Included the Vite server/config files in the app typecheck so the one-server path is covered by `bun --cwd apps/wiki-vite typecheck`.
- Kept current-route markdown fetching on the explicit priority path and excluded it from the idle eager queue. This preserves the intended current-first behavior without racing the failed-fetch retry UI.
- Verified the one-server Vite API path on port `62001`: `/api/wiki/session` returned the public identity and `/api/wiki/manifest` returned 4,722 public pages, 10,501 assets, and manifest hash `68578c2cc12675cfa2656fca`.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd packages/wiki-content typecheck
bun --cwd web test:unit src/lib/wiki-api-routes.test.ts
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite test:e2e e2e/page-load-experience.spec.ts e2e/session-recovery.spec.ts
bun --cwd apps/wiki-vite test:e2e
bun run typecheck
```

### 2026-05-09 Markdown Package Test Expansion Checkpoint

- Expanded `@diana-tnbc/wiki-markdown` server-rendering tests so the reusable package now directly covers smart-table example fixtures, legacy table directive cleanup, PDF/image URL rewriting, citation variants, generated references anchors, non-citation superscript guardrails, theme-paired images, image-theater attributes, and math/currency behavior.
- This pulls more durable markdown confidence out of `web` and into the shared package boundary, reducing the behavior that is protected only by the current Next app.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-markdown test:unit
bun --cwd packages/wiki-markdown typecheck
```

### 2026-05-09 Source Provenance Checkpoint

- Added local source-file provenance to the Vite page chrome. Pages with related asset paths now show manifest-backed PDF/file links without waiting on server-rendered HTML.
- Added current-page source-file actions to the command palette while keeping canonical search, chat, downloads, and AI surfaces as backend handoffs.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-chrome.spec.ts e2e/command-palette.spec.ts
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite test:e2e
```

### 2026-05-09 Mobile Outline Checkpoint

- Added a mobile page outline control inside the Vite article chrome. It uses the same local heading collector as the desktop rail and command palette, so mobile heading jumps stay client-local.
- Kept the desktop outline rail unchanged and hidden on small screens; mobile readers now get an inline collapsible outline instead of relying only on the global command palette.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-chrome.spec.ts
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite test:e2e
```

### 2026-05-09 Convex Deployment Checkpoint

- Deployed the additive Convex backend functions to `https://youthful-cricket-560.convex.cloud`.
- Verified the single-server Vite backend path against the deployed Convex backend on local port `62002`.
- `/api/wiki/session` returned the public Diana store identity, and `/api/wiki/manifest` returned 4,722 public pages, 10,501 assets, and manifest hash `68578c2cc12675cfa2656fca`.
- Verification commands run for this checkpoint:

```sh
set -a; source web/.env.local; set +a; bunx convex deploy
PORT=62002 bun --cwd apps/wiki-vite dev
curl -sS http://127.0.0.1:62002/api/wiki/session
curl -sS http://127.0.0.1:62002/api/wiki/manifest
```

### 2026-05-09 Backend Handoff And Visual Parity Checkpoint

- Search and chat handoffs now preserve reader context with `returnTo`, so backend-owned full-stack surfaces can route users back to the Vite reader page they came from.
- The local page finder now offers a backend search handoff with the active query when local manifest results are empty. This keeps canonical search on the backend while making the Vite reader feel continuous.
- Added screenshot-backed visual parity coverage for desktop and mobile reader shells, plus CSS assertions for the Diana-style visual tokens.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/search.spec.ts e2e/command-palette.spec.ts
bun --cwd apps/wiki-vite test:e2e e2e/visual-parity.spec.ts --update-snapshots
bun --cwd apps/wiki-vite test:e2e e2e/visual-parity.spec.ts
```

### 2026-05-09 Session Cache-Key Rotation Checkpoint

- Added browser coverage for server-issued session cache-key rotation. When the session identity returns a new `cacheKey`, the reader opens a different LiveStore store id instead of reusing the previous authenticated cache.
- Extended the Vite Playwright API fixture so tests can mutate session authentication and cache identity without rebuilding route handlers.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/session-recovery.spec.ts
```

### 2026-05-09 Standalone Full-Stack Server Checkpoint

- Refactored the Vite wiki backend into a reusable request handler shared by dev middleware and a standalone server.
- Added `apps/wiki-vite/server/standalone.ts` and `bun run start:server`. After `bun run build`, this serves `dist/`, `/api/wiki/*`, `/api/file`, and `/api/page-copy` from one Bun process while Convex remains the content database.
- Verified the standalone server returned the built HTML shell, public session identity, and a public markdown page batch from the deployed Convex backend.
- Ran the existing preview smoke test against the standalone server.
- Re-ran the full Vite Playwright migration suite after the shared handler refactor: `56 passed, 72 skipped`.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
PORT=62003 bun --cwd apps/wiki-vite start:server
curl -sSI http://127.0.0.1:62003/
curl -sS http://127.0.0.1:62003/api/wiki/session
curl -sS 'http://127.0.0.1:62003/api/wiki/pages?limit=1'
PLAYWRIGHT_BASE_URL=http://127.0.0.1:62004 bun --cwd apps/wiki-vite test:e2e:preview
bun --cwd apps/wiki-vite test:e2e
```

### 2026-05-09 Bundle Budget Checkpoint

- Added `bun run check:bundle` for `apps/wiki-vite` so tree-shaking regressions fail explicitly after a production build.
- The budget check reports raw and gzip sizes for entry, React, LiveStore, Effect, markdown, page/sync chunks, workers, and SQLite wasm assets.
- Current built asset total is `1067.0 KiB` gzip including wasm and workers; the entry script is `3.4 KiB` gzip while markdown, LiveStore, and Effect remain split behind separate chunks.
- The current budgets are intentionally close to the known prototype shape, with room for normal hash/minifier drift but not for accidentally pulling markdown or LiveStore back into the entry path.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
```

### 2026-05-09 Markdown Package Hardening Checkpoint

- Added package-level server renderer tests for smart-table markup, PDF chips, image theater attributes, citations, theme-paired images, currency preservation, and math rendering.
- Fixed `renderWikiMarkdownHtml` so ordinary markdown links to proxied file types, including `paper.pdf`, are rewritten through `/api/file` before PDF chip decoration.
- Added Vite route metadata polish by updating the document title and description meta tag from the local page index.
- Re-ran the existing `web` render-markdown unit tests to confirm the shared package behavior still matches the current app.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-markdown test:unit
bun --cwd packages/wiki-markdown typecheck
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-chrome.spec.ts
bun --cwd web test:unit src/lib/render-markdown.test.ts
```

### 2026-05-09 Content Package Hardening Checkpoint

- Broadened `packages/wiki-content` tests for invalid manifest payloads, page batch pagination cursors, deleted/missing hash reconciliation, and public/session store-id sanitization.
- These tests keep malformed backend payloads from reaching the Vite LiveStore materializers and protect the sensitive public/session cache boundary.
- Verification commands run for this checkpoint:

```sh
bun --cwd packages/wiki-content test:unit
bun --cwd packages/wiki-content typecheck
```

### 2026-05-09 Session And Cache Controls Checkpoint

- Added a recoverable session-scope failure screen so `?scope=session` no longer dead-ends when the user is not signed in.
- Added a header scope switcher that preserves the current route while moving between public and session LiveStore stores.
- Added a manual cache-warming control to the optional footer. It reuses the Vite eager markdown queue and keeps markdown fetching client-local while the backend remains the content source.
- Added a stale-content notice when cached markdown is being shown while a newer hash is fetched in the background.
- Added Playwright coverage for session fallback, route-preserving scope links, footer cache warming, and the existing cache reset flow.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/session-recovery.spec.ts e2e/livestore-devtools.spec.ts e2e/page-chrome.spec.ts
```

### 2026-05-09 Page Chrome Checkpoint

- Added reader breadcrumbs, page descriptions, and a compact page-action row to the Vite reader.
- Added local copy-as-markdown and copy-link actions that use the cached markdown body instead of waiting on server-rendered HTML.
- Added backend handoff links for markdown download through `/api/page-copy` and opening the same page in the current Next app.
- Added a persistent desktop outline rail sourced from rendered markdown headings, sharing the same outline extraction helper as the command palette.
- Added Playwright coverage for breadcrumbs, descriptions, page actions, local markdown copy, and outline-rail hash navigation.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-chrome.spec.ts e2e/command-palette.spec.ts e2e/navigation.spec.ts
```

### 2026-05-09 Performance Metrics Checkpoint

- Added route render timing to the Vite metrics panel so cold and warm page renders are visible during local/preview review.
- Added a warm-route metric that updates when navigation renders from the local LiveStore page body cache.
- Added a failed body-fetch counter for markdown fetch misses/errors.
- Extended page-load Playwright coverage to keep the instrumentation visible while preserving the warm-navigation no-refetch assertion.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/page-load-experience.spec.ts e2e/navigation.spec.ts
```

### 2026-05-09 Asset Palette Checkpoint

- Added an Assets mode to the Vite command palette backed by the local LiveStore `assetIndex`.
- PDF and file assets remain served by the existing backend `/api/file` route; the Vite reader only exposes fast local discovery and handoff links.
- Added Playwright coverage for PDF and image asset discovery through the command palette while preserving existing sidebar PDF/source coverage.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/command-palette.spec.ts e2e/sidebar-pdfs.spec.ts
```

### 2026-05-09 Reader Parity Checkpoint

- Added Diana-style header actions to the Vite reader: local palette, backend search handoff, and backend chat handoff.
- Added a local command palette backed by the LiveStore page index. `Cmd/Ctrl+K` opens page navigation, `Cmd/Ctrl+Shift+K` opens backend-owned actions, and `Cmd/Ctrl+Shift+O` opens the local outline palette.
- Added an outline palette that reads headings from the rendered markdown and updates the URL hash without fetching server-rendered HTML.
- Kept canonical search, AI search, chat, and download implementation on the existing backend/full-stack surface for v1. The Vite app now links to those surfaces instead of cloning them.
- Verified the local browser route `http://127.0.0.1:60001/wiki/logistics/insurance` shows the new header and palette with backend links pointing at the configured Next origin.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/command-palette.spec.ts e2e/navigation.spec.ts e2e/search.spec.ts
```

### 2026-05-09 Sidebar Parity Checkpoint

- Updated the Vite file tree so deep-linked pages auto-expand their active ancestor directories.
- Persisted manual sidebar expansion in local storage so the tree does not collapse on reload.
- Applied the same expansion model to the mobile navigation sheet.
- Added Playwright coverage for active-branch expansion and persisted directory expansion.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/navigation.spec.ts e2e/sidebar-pdfs.spec.ts e2e/page-load-experience.spec.ts
```

### 2026-05-09 Cache Controls Checkpoint

- Added an explicit local LiveStore cache reset action to the optional footer.
- The reset path commits `v1.CacheResetRequested`, clears the local reader tables, and reloads the route so the manifest/page body repopulate from the backend APIs.
- Kept reset scoped to the local Vite reader cache; it does not mutate Convex, publish state, or the current Next app cache.
- Added Playwright coverage for the footer reset confirmation and reload behavior.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite test:e2e e2e/livestore-devtools.spec.ts
```

### 2026-05-09 Local Verification Checkpoint

- Ran the full migrated Vite Playwright suite after the reader parity, sidebar, cache-control, page-chrome, performance-metrics, and asset-palette work.
- Result: 42 passed, 72 skipped. The skipped tests are intentionally retained as the Next-owned feature inventory for chat, comments, backend search/AI search, metadata, PII, multi-site isolation, backend PDF error paths, and timeline/mermaid work.
- Confirmed the Vite production build completes and keeps LiveStore, React, markdown, icon, and page chunks split.
- Re-ran the backend wiki API unit tests after the Convex deploy/pagination fix.
- Re-ran root typecheck across `web`, `apps/wiki-vite`, `packages/wiki-content`, `packages/wiki-markdown`, `@diana-tnbc/chat`, and `@diana-tnbc/smart-table`.
- Verification commands run for this checkpoint:

```sh
bun --cwd apps/wiki-vite test:e2e
bun --cwd apps/wiki-vite build
bun --cwd web test:unit src/lib/wiki-api-routes.test.ts
bun --cwd packages/wiki-content test:unit
bun --cwd packages/wiki-markdown test:unit
bun run typecheck
```

Latest verification update:

```sh
bun --cwd apps/wiki-vite test:e2e
bun --cwd apps/wiki-vite build
bun run typecheck
```

Latest result: `49 passed, 72 skipped` for the Vite Playwright suite.

### 2026-05-09 Backend Deployment Checkpoint

- Deployed the additive Convex backend to `https://youthful-cricket-560.convex.cloud` with `bunx convex deploy --env-file .env.local --typecheck try`.
- Verified the Vite reader is using the deployed Convex manifest path through the Next API shim: `GET /api/wiki/manifest` returned `X-Wiki-Manifest-Source: manifest`, 4,722 public pages, 10,501 assets, and manifest hash `68578c2cc12675cfa2656fca`.
- Found and fixed a production pagination edge case in `GET /api/wiki/pages`: Convex document pagination can return an empty visible page after sensitive/site filtering. The API now advances through filtered pages until it returns visible markdown or reaches the end.
- Verified `GET /api/wiki/pages?limit=2` now returns visible public markdown bodies (`README`, `about/About`) instead of an empty page with a continuation cursor.
- Added `web/src/lib/wiki-api-routes.test.ts` coverage for the filtered-page pagination behavior.
- Verification commands run for this checkpoint:

```sh
bun --cwd web test:unit src/lib/wiki-api-routes.test.ts
bun --cwd apps/wiki-vite typecheck
```

## Additive Backend Rollout

Deploying the manifest and page APIs is a good next step because the change can be shipped without changing the reader route owner.

Recommended order:

1. Deploy the additive Convex function `documents.listManifestPage`.
2. Deploy the additive Next API routes under `/api/wiki/*`.
3. Keep existing routes, publish, search, chat, comments, downloads, and AI flows unchanged.
4. Verify public requests exclude `sensitive` pages and assets.
5. Verify session requests use private cache headers and separate store ids.
6. Point `apps/wiki-vite` at the deployed API origin from a separate preview.

This rollout should not introduce a new content visibility concept. The only privacy flag remains `sensitive`.

Stop conditions:

- Public `/api/wiki/manifest` or `/api/wiki/pages` includes a sensitive page.
- Session requests can be cached publicly.
- Manifest hashes change only because `generatedAt` changed.
- The manifest endpoint cannot produce reliable content hashes and does not fail closed.
- The Vite preview requires changing production wiki routes.

## Missing Feature Inventory

These are the major gaps between the prototype and the current wiki experience.

### Migration Backlog Priority

This backlog is ordered around the replacement goal: deploy `apps/wiki-vite` as the standalone app and make deleting `web` a low-drama cleanup. Comments and Liveblocks are explicitly parked in the backlog; they should not block the Vite replacement unless the product scope changes.

### 2026-05-10 P0 Parity Audit Checklist

Use this checklist before calling the Vite app a standalone replacement. The important rule is that each item needs either active automated coverage or an explicit product decision to defer it. Passing fixture-only tests is not enough when the same behavior can fail on the live manifest, persisted OPFS cache, or deployed preview.

#### Launch-Blocking Findings

| Gap | Evidence | Acceptance |
| --- | --- | --- |
| Live sidebar tree still exposes `images` directories | In-app browser on `/wiki/logistics/insurance` showed image-only directories even though `packages/wiki-content` and fixture Playwright coverage now filter them. | Live `/api/wiki/manifest`, LiveStore hydrated tree, sidebar UI, asset palette, and source routes all agree: image directories are hidden from the navigation tree, image assets remain usable from markdown and asset actions, and old OPFS stores are versioned/reset so stale image nodes disappear. |
| Expanded tables ignore rail bounds | In-app browser on `/about/Terminology` showed expanded smart tables overlapping the left navigation rail. The web table spec requires the expanded table lane to sit between the left navigation rail and the right outline/comments rail. | Port or re-create the rail-aware table lane contract: expanded surfaces start after the visible left rail, end before the visible right rail, update on left collapse/resize, update on right collapse/resize, and never cover either rail. |
| Right rail is not a full layout participant | Vite has a basic outline, but not the current app's right rail semantics for outline/comments mode, collapse, resize, mobile behavior, or table-lane coordination. | Right rail state is explicit and testable. Outline-only mode works without comments, comments remain parked, and table expansion plus main content width respond to right rail open/collapsed/resized states. |
| Clean cold route loads can stall behind manifest/backend fallback | Clean headless browser routes rendered the shell and stayed at "Loading markdown..."; server logs showed repeated Convex manifest errors and fallback attempts; direct manifest fetch hung during the audit. Warmed in-app browser cache masked the issue. | Cold deep links must render current-route markdown or a deterministic retry/error state within the route budget, even when Convex manifest queries fail. Manifest/page APIs need timeout/circuit-breaker behavior, fallback responses, and observable errors instead of indefinite pending requests. |
| Fixture route coverage hides missing real routes | `/table-examples` is useful in tests but is not backed by the real Vite route/content path, so route-level table regressions can pass locally. | Keep fixture tests, but add real-route table coverage using content that exists in the live manifest, such as `/about/Terminology`, plus one explicit route smoke for any diagnostic/demo routes we intend to expose. |
| Skipped P0 specs create false confidence | Vite still skips metadata browser placeholders, chat navigation resilience, and all comments/Liveblocks coverage. Some of those are acceptable backlog, but metadata and chat resilience are replacement surfaces. | Convert metadata and chat resilience into active standalone/dev tests or move them out of P0 with a written product decision. Keep comments/Liveblocks marked parked unless explicitly pulled into launch scope. |

#### Functional Parity

| Surface | Checklist |
| --- | --- |
| Routing and canonical URLs | Deep links load cold and warm; `/wiki/...`, legacy root aliases, source routes, PDFs, mixed-case slugs, `.md` aliases, moved/renamed source slugs, and hash fragments canonicalize the same way as the current app. Login redirects preserve path, query, and hash. Unknown routes show recovery without poisoning the cache. |
| Password gate and auth | App routes enforce the password gate before serving private shell content. Public APIs stay public-only. Session APIs use private cache headers. Magic-token links strip tokens after login. Expired session behavior clears only the session store and returns the user to a meaningful recovery path. |
| Manifest and page APIs | Public manifest/pages exclude sensitive pages; session manifest/pages include allowed sensitive pages with private cache headers; hashes and ETags are stable across `generatedAt` drift; pagination is stable; backend fallback cannot hang; errors are visible and retryable. |
| LiveStore cache behavior | Store ids include site, origin, scope, cache version, and session key; OPFS cache invalidates when tree shape or privacy semantics change; warm navigation avoids page-body network fetches; stale local markdown shows a subtle update state; deleted/missing pages reconcile predictably. |
| Sidebar tree | The left rail supports collapse, expand, resize, persisted width, keyboard navigation, active branch reveal, intentional branch collapse, mobile sheet behavior, source/PDF grouping, document icons, and hidden image directory filtering on real data. Very large trees should remain scrollable and responsive. |
| Breadcrumbs and page chrome | Breadcrumbs use manifest titles, link only to existing pages, expose `aria-current`, and match web spacing/typography. Page chrome includes title, description, tags, source provenance, sensitive/stale/missing badges, copy link, print, downloads, and main-app/source actions with parity labels and icons. |
| Header and action menus | Search, palette, chat, account/session state, theme switching, downloads, source actions, keyboard shortcuts, and mobile overflow match the current app. Devtools/metrics remain hidden unless `?devtools=1` or `?livestoreDevtools=1` is present. |
| Command palette and local finders | Page, outline, asset, tag, recent, backend action, and cache/debug modes are keyboard-accessible; focus is trapped; Escape closes; arrow/Enter selection works; command palette navigation does not flash stale outline rows; fuzzy ranking and empty states match the current app closely enough for daily use. |
| Search and AI search | Text search remains backend-owned; AI search remains backend-owned; result cards include snippets/highlights, tags, citations/source links, loading/empty/error states, keyboard selection, sensitive-session handling, PII redaction, and live preview/prod smoke coverage. |
| Chat | Vite owns `/chat`, `/chat/:id`, and `/api/chat`; conversation list, archived state, mobile history, edit/resend, stop, retry, copy, source pills, tool-call display, route navigation, refresh mid-stream, failed-stream recovery, site scoping, PII redaction, first-token timing, full-completion timing, and cost/rate guardrails need active coverage before deletion of `web`. |
| Downloads and file actions | Per-page markdown copy/download, full markdown bundle, PDF open-in-new-tab, source markdown, image/file assets, unsupported type errors, path traversal rejection, public/session cache headers, and sensitive exclusion all behave through the Vite backend. |
| Multi-site isolation | Host-derived site resolution wins over injected headers. Same-slug pages across sites cannot share LiveStore bodies, search results, AI citations, chat tool reads, file downloads, or page-copy output. Add a seeded non-Diana dev site before cutover, not just synthetic mocks. |
| PII parity | Rendered pages, search, AI search, chat tools, downloads, page-copy, and source routes apply the same redaction policy as the current app. Add non-Diana site-specific PII pattern tests and live session-auth sensitive-page checks. |
| Metadata and minimal server render | Bot requests receive page-specific canonical, title, description, OG, Twitter, and robots metadata without bypassing the normal browser password gate. Authenticated browser HTML uses private no-store semantics. No-JS or slow-JS shells should expose enough page structure to avoid a blank loading-only experience. |
| Mobile behavior | Mobile sidebar sheet, bottom navigation, chat history, command palette, outline, table expansion, safe-area spacing, header actions, text wrapping, and touch targets need route screenshots and interaction tests across the canonical mobile viewport. |

#### Markdown and Aesthetic Parity

| Surface | Checklist |
| --- | --- |
| Typography | Body font, heading scale, h4/h5 details, line height, paragraph rhythm, link color, strong/emphasis, inline code, pre blocks, blockquotes, horizontal rules, and list nesting should visually match the current Diana site in light and dark themes. |
| Smart tables | Match the full `web/specs/table-expansion.md` contract: first-paint table styling without JS, compact width controls, manual resize, expand/collapse, horizontal overflow, vertical page scroll ownership, right-edge fade, sidebar collapse/resize updates, reload cleanup, mobile fallback, and no orphan overlays. |
| Right outline rail | Outline active-state, hash updates, scroll tracking, collapse/resize controls, mobile outline access, and coordination with smart tables must be treated as reader layout, not comments-only backlog. |
| Comments rail | Parked for now, but keep the reference checklist: page comments, text selection comments, thread counts, resolved filter, unread state, global comments, Liveblocks auth, multi-device sync, right rail resize, and mobile comments access. If `web` deletion happens before comments ship, the product must explicitly accept comments being unavailable. |
| Images and media | Image theater, local image path rewriting, theme-paired images, PDF chips, SVG/document icons, captions, broken-image fallback, and asset palette actions should match the current app. Hidden image directories must not leak into navigation. |
| Citations, math, Mermaid, and raw HTML | Citations link and style correctly; math warnings do not flood dev/prod logs; Mermaid/timeline fallbacks are visually acceptable; raw HTML/sanitization matches current security and rendering behavior. |
| Visual snapshots | Add canonical desktop/mobile snapshots for `/wiki/logistics/insurance`, `/wiki/people/medical-team`, `/wiki/updates/week-5-april-12-to-18`, a table-heavy page such as `/about/Terminology`, a source page, a PDF/source route, `/search`, and `/chat`. Compare against the current app before cutover. |
| Accessibility | Landmark structure, aria labels, `aria-expanded`, `aria-current`, dialog semantics, focus order, visible focus rings, reduced-motion behavior, contrast, and keyboard-only completion for sidebar, palette, search, chat, table expansion, and rail controls need explicit checks. |

#### Component Reuse Extraction Plan

The fastest path to visual parity is to extract the mature current-app shell into shared package components and make Vite a data/router adapter around them. This keeps the final framework change small and avoids maintaining two subtly different Diana UIs.

| Surface | Current app source | Vite equivalent | Reuse plan | Priority |
| --- | --- | --- | --- | --- |
| Right rail and outline | `web/src/components/document-comments.tsx` (`OutlineShell`, `SidebarButton`, `RailToggleIcon`, persisted pane state, CSS vars) | `apps/wiki-vite/src/pages/PageOutline.tsx` and `apps/wiki-vite/src/shell/outline.ts` | Extract an outline-only right rail into `packages/wiki-shell/right-rail` with adapters for heading collection, hash navigation, and scroll state. Use it in Vite with the current app's collapsed-default desktop rail, mobile rail, resize state, and table-lane CSS variables. Keep comments parked behind the same rail shell. | P0 |
| Resizable layout | `web/src/components/resizable-layout.tsx` | `apps/wiki-vite/src/shell/ResizableAppShell.tsx` | Move the layout primitive into `packages/wiki-shell/layout`; keep optional persisted width/collapse adapters so Vite can preserve OPFS/local settings while matching current sizing and handles. | P0 |
| Header and actions | `web/src/components/header.tsx`, `actions-menu.tsx`, `theme-toggle.tsx` | `apps/wiki-vite/src/shell/Header.tsx` | `WikiHeader`, `WikiHeaderSearchForm`, `WikiHeaderButton`, `WikiHeaderLink`, and `WikiLogo` now live in `packages/wiki-shell`. Vite consumes them with backend-owned search, chat, command-palette, and overflow adapters. Remaining work is richer account/session/theme action parity and page-level overflow actions. | P0 partially done |
| Page title/chrome | `web/src/app/(main)/_components/document-page.tsx`, `copy-page-button.tsx` | `apps/wiki-vite/src/pages/WikiPage.tsx` | Extract a page header that matches the current app: title, compact copy affordance, tags, and overflow/source/download actions. Hide or demote Vite-only breadcrumbs, size badges, and large action rows unless the existing site has an equivalent. | P0 |
| Sidebar tree and mobile nav | `web/src/components/sidebar.tsx`, `bottom-nav.tsx` | `apps/wiki-vite/src/shell/Navigation.tsx` | Extract tree rows, document icons, active/expanded styling, mobile sheet/bottom-nav shell, and resize affordances with a `LinkComponent`/`getHref` adapter. Feed Vite's LiveStore tree into the shared visual component. | P1 |
| Prose, theme, and media styles | `web/src/app/globals.css`, markdown renderer CSS, image theater CSS | `apps/wiki-vite/src/styles.css`, `packages/wiki-markdown` styles | Move Diana theme tokens, `.dark` behavior, `.prose` rhythm, smart-table lane variables, image theater styling, PDF chips, and shared markdown CSS into package-owned styles imported by both apps. Vite should render markdown through the same `.prose max-w-none` contract. | P0 |
| Command palette and page finder | `web/src/components/command-palette.tsx` | `apps/wiki-vite/src/shell/CommandPalette.tsx` | Share row layout, focus states, keyboard semantics, and empty states. Keep Vite's LiveStore-backed pages/outline/assets/tag data as adapter inputs. | P1 |
| Loading, empty, and error states | `web/src/components/page-loading.tsx`, not-found/error shells | Vite route-level retry/not-found UI | Extract skeletons and recovery layouts so cold-load, stale, missing, and failed-fetch states look like the current app. | P1 |
| Search and chat chrome | Current search/chat route components and shared composer pieces | `apps/wiki-vite/src/pages/SearchPage.tsx`, Vite chat route | Keep Vite backend ownership, but reuse cards, pills, source links, mobile layouts, composer styling, and action menus where possible. | P1 |

Extraction sequence:

1. Create `packages/wiki-shell` with right rail, resizable layout, shared shell CSS, and package tests for pane state/class contracts.
2. Replace Vite's `PageOutline` with the shared right rail and add browser tests for collapsed default, resize, mobile rail, hash navigation, and expanded-table bounds with both rails.
3. Move prose/theme CSS into shared package styles and make Vite render through the same `.prose` contract as the current app.
4. Extract header/page chrome next so Vite stops exposing a different top-level product shape.
5. Extract sidebar/bottom navigation, then polish command palette/search/chat rows with shared styles.

#### Test Coverage Actions

| Action | Why |
| --- | --- |
| Promote the web table-expansion cases into Vite with real routes | The current Vite table tests are too light and did not catch rail overlap. Port the web cases for sidebar collapse, right rail, vertical scroll owner, horizontal overflow, manual widths, reload cleanup, and first-paint styling. |
| Add a live-manifest sidebar smoke | The image-directory bug appeared only with live data or existing OPFS cache, not the fixture tree. Add a smoke that uses the real dev backend, resets cache, loads `/wiki/logistics/insurance`, and asserts no image-only directories appear in the sidebar. |
| Add clean-browser cold-load tests | Warm OPFS can mask broken priority fetch and manifest fallback behavior. Run a clean browser context for canonical routes and assert content renders or a bounded retry/error state appears within the route budget. |
| Separate fixture, live-local, standalone, preview, and production suites | Keep fast fixtures for iteration, but require live-local and preview suites before cutover. Standalone metadata/password-gate tests should be first-class, not hidden behind manual smoke notes. |
| Turn skipped P0 placeholders into active tests | Metadata and chat navigation resilience need active coverage. Comments/Liveblocks can remain skipped only with the parked backlog decision attached to the skip title. |
| Add visual diff gates | Desktop/mobile visual snapshots should cover the chrome, table-heavy pages, source pages, search, and chat. The old app should remain the reference until the snapshots are intentionally accepted. |

#### P0: Replacement Blockers

These must be green before the Vite app can replace the current web app for production traffic.

| Area | Why it blocks cutover | Concrete work | E2E acceptance |
| --- | --- | --- | --- |
| Live manifest and cold-load reliability | Warm OPFS can hide backend failures, but a replacement app must render cold routes reliably. The audit found clean browsers stuck at "Loading markdown..." while `/api/wiki/manifest` was blocked behind repeated Convex/fallback errors. | Add API timeouts/circuit breakers, bounded fallback manifest generation, route-level retry/error UI, and current-route priority fetch that can succeed even when the full manifest is degraded. | Clean browser tests for canonical routes render body content or a deterministic retry/error state within the route budget; manifest probes cannot hang indefinitely. |
| Rail-aware table and right-sidebar layout | Expanded tables currently can overlap the left rail, and the incomplete right rail means the table lane cannot match the current app. | Port the table expansion layout contract, make left and right rails layout participants, add right rail collapse/resize state, and keep comments parked behind the same rail shell. | Vite passes ported table-expansion specs for left collapse/resize, right rail open/collapsed/resized, vertical/horizontal scrolling, manual widths, mobile fallback, and reload cleanup. |
| Real-data sidebar parity | Fixture coverage hides a live-data bug where `images` directories still appear in navigation. | Fix the backend manifest/tree path and LiveStore cache migration so hidden image directories are removed from live trees without hiding image assets from markdown or asset actions. | Live backend sidebar smoke on `/wiki/logistics/insurance` proves no image-only directories in the nav, assets remain available, and old cache versions do not reintroduce stale nodes. |
| Metadata hardening | The standalone server now injects page-specific title/description, canonical URLs, and OG tags, lets link-preview bots receive metadata-only HTML without a login cookie, keeps normal unauthenticated browsers gated, and uses public/private cache headers by request type. | Add Twitter/robots policy details and decide whether the old header-shell/browser metadata placeholder should become a standalone-only test instead of a dev-server Playwright spec. | `verify:standalone` now covers bot metadata, authenticated metadata, normal gate redirects, canonical/OG tags, and cache headers. |
| Multi-site isolation | Active P0 coverage now proves same-slug cold/warm store separation, injected header overwrite, search/AI/tool/page-copy/file isolation, unknown-site fail-closed behavior, and site-scoped LiveStore store ids. | Replace the mocked synthetic-site checks with a seeded dev Convex site before production cutover, then run the same invariants against a deployed preview URL. | `multi-site-isolation.spec.ts` is active for the Vite-owned invariants and passes locally. |
| PII parity | Active P0 coverage now proves rendered pages, `showPII`, inline redaction blocks, text search, AI search summaries, chat tool reads, page-copy, and full markdown downloads do not expose known identifiers. The Vite backend also redacts defensively even though Convex content should already be redacted at publish time. | Expand with site-specific PII-pattern fixtures for a non-Diana site and a live session-auth sensitive result check. | `pii-redaction.spec.ts` is active and passes locally; backend API tests also assert live search/download/tool responses exclude known Diana identifiers. |
| Chat resilience and performance | Client/server chat now carries active `siteSlug` through Convex calls, server-side cancel polling already exists, and active perf coverage proves composer readiness, the browser perf buffer, first-token timing, and full-completion timing. | Finish `chat-nav-resilience.spec.ts`: stop button aborts server-side in browser, navigate away/return resumes conversation state, refresh mid-stream remains observable, and mobile conversation navigation gets a dedicated layout pass. | `chat-perf.spec.ts` is active and passes locally; deeper navigation-resilience placeholders remain. |
| Deployment and ops | Local one-server verification now covers password gate, metadata smoke, backend session/search/tools/chat/login/file smokes, and preview smoke against the standalone origin. | Configure the actual Vercel standalone/service deployment, env vars, preview smoke job, production smoke job, and rollback notes. Keep `verify:wiki-vite` in CI for the replacement path. | Preview URL still needs to pass standalone smoke, metadata smoke, backend API smoke, and core reader/search/chat e2e against the deployed Convex backend. |

#### P1: Parity And Polish

These should land before a broad user-facing rollout, but they can follow the P0 safety work if needed.

| Area | Work | Acceptance |
| --- | --- | --- |
| Auth/session UX | Hash-preserving session recovery, scope switching, and login return-target copy landed. Remaining: login styling polish, expired-session edge cases beyond current public fallback, and production auth copy. | Current focused tests cover hash-preserving redirect, public fallback, session store separation, and cache-key rotation. |
| Downloads and file actions | Vite now owns scoped `/api/page-copy`, `/api/file`, and `/api/download?type=full` markdown-bundle behavior for the standalone path. Remaining: richer per-page source/download actions and production full-export format decisions. | Backend tests cover scoped markdown downloads; page chrome tests fetch page markdown through the Vite API boundary. |
| Search/AI result UX | Result cards keep native links, support arrow/Enter keyboard selection, show tag context, preserve AI summaries/relevance, and publish search metrics to the observability buffer. Remaining: richer citations and sensitive-session result presentation. | Search route tests cover keyboard selection, AI tags/summaries, error fallback, and session-only local results. |
| Command palette and sidebar accessibility | Palette mode buttons expose pressed state, keyboard highlighting works without losing native button/link semantics, sidebar directories expose expanded state, current page links expose `aria-current`, and the mobile sheet is a dialog. Remaining: deeper focus trapping and very large tree behavior. | Focused tests cover palette keyboard selection, tab state, sidebar expansion/current state, outline jumps, and asset actions. |
| Observability | The metrics panel exposes a stable test hook and `window.__WIKI_VITE_OBSERVABILITY__` stores the latest route metrics plus recent search timings. Remaining: chat first-token/full-completion timings and preview/prod reporting. | Page-load tests inspect route metrics through the observability buffer; search tests inspect AI-search timing records. |

#### Parked Backlog

These are intentionally not part of the standalone replacement blocker set right now.

| Area | Reason parked | Re-entry trigger |
| --- | --- | --- |
| Comments and Liveblocks | They require Liveblocks tokens, thread persistence, comment rail UX, multi-device sync, unread/resolved state, and per-site readiness. The replacement reader can ship without collaborative comments. | Pull forward only if comments become a launch requirement or if the current Next comments surface must be deleted before replacement. |
| Comment API migration | Depends on the same comments/Liveblocks decision and should not be implemented independently. | Same as comments; otherwise leave skipped specs as explicit backlog inventory. |
| Advanced chat workflows | Approval tools, publish/edit through chat, and multi-agent chat features are beyond reader replacement parity. | Revisit after basic chat resilience, site scoping, and cost controls are stable. |

| Feature area | Current prototype | Missing work | V1 stance |
| --- | --- | --- | --- |
| Page finder | Header finder filters the local page index by title, slug, and tags. The command palette provides keyboard page navigation, tag slices, and recent pages from local LiveStore/localStorage state. | Better fuzzy scoring, source/PDF context actions, and richer empty states. | Keep this client-local because it is a navigation affordance backed by the manifest, not canonical search. |
| Text search | Vite serves `/api/search` from the one-server backend path and owns a `/search` page with backend results and reader navigation. The header and action palette preserve `returnTo`, and the local finder transfers the active query when local matches are empty. | Better snippets, keyboard/result polish, loading/empty/error refinement, and public/session search leak tests. | Keep canonical full-text search backend-owned. The Vite reader should not rebuild search from the local markdown cache. |
| Chat | Vite owns `/chat`, `/chat/:id`, and `/api/chat` with the shared full composer/message UI, Convex conversation list/loading, AI SDK streaming route, and wiki search/read/list tools. The header now navigates into the Vite chat route instead of handing off to Next. | Abort/resume/refresh resilience, mobile conversation navigation polish, multi-site client-side Convex scoping, perf buffer coverage, cost/rate guardrails, and broader preview/prod credentialed smoke coverage. | Keep chat full-stack and backend-owned inside Vite. Comments remain parked, but chat is now part of standalone replacement parity. |
| AI search | Vite owns `/api/ai-search` and an AI mode on `/search`. The route uses backend text candidates, optional embedding/vector candidates, Host-resolved site scope, session-sensitive reads, PII redaction, and AI SDK structured scoring. | Citation rendering, richer result metadata, live credentialed route smoke in preview/prod, and sensitive-result leak tests with real session auth. | Backend-owned parity surface. It should stay server-side and should not be rebuilt from local cached markdown. |
| Outline | Local outline palette, persistent desktop outline rail, and mobile inline outline extract headings from rendered markdown and jump by hash. | Hash navigation polish and accessibility pass. | Should land before reader parity because it is a core reading affordance and can be fully local. |
| Comments and Liveblocks | Not implemented in Vite. | Comment rail, auth gating, Liveblocks tokens, thread persistence, unread/resolved states, and multi-device sync. | Parked backlog. Do not treat as a cutover blocker unless explicitly pulled forward. |
| Command palette | Keyboard trigger, local page rows, outline rows, asset rows, tag slices, recent pages, current-page source/PDF actions, backend action rows, and debug/cache tools landed. | Better fuzzy ranking, richer current-page context actions, and a deeper focus/accessibility pass. | Build before production reader parity. It can be powered by the local LiveStore index, while search/chat actions delegate to backend surfaces. |
| Other palettes | Page, outline, asset, tag, recent, backend action, and debug/cache palettes now exist as modes in one command surface. | Metrics drill-downs and richer cache diagnostics. | Page palette should be first. Backend search/chat entries should delegate instead of cloning those full-stack flows. |
| Sidebar/tree | Desktop tree and mobile sheet exist, active branches auto-expand, manual expansion persists across reloads, and PDF/file assets are discoverable through the local asset palette. | Richer source grouping, keyboard navigation, and very large tree performance. | Needed before broad preview review, but not before additive backend deployment. |
| Page chrome | Title, description, breadcrumbs, tags, copy/link/print/download/main-app actions, manifest-backed source/PDF provenance, size, stale/sensitive badges, not-found recovery, failed-fetch retry, and manifest/hash footer exist. | Edit/source provenance and richer mobile action placement. | Reader parity blocker for pages with sources/assets. |
| Markdown parity | Shared package handles the main rendering path, including a client-safe Mermaid fallback for timeline/Gantt fences. Package tests cover key server transforms plus client Mermaid and route-link adapter behavior. | More package tests for unusual markdown/media edge cases. | Required before trusting the package as the durable reader layer. |
| Auth/session UX | Scope can be selected with `?scope=session` or the header switcher; session identity creates a distinct store id; signed-out session access shows a recovery screen; auth-expired fetches clear the session store; cache-key rotation opens a separate authenticated store; cross-origin previews use credentialed API requests only when the backend origin is explicitly configured and allowlisted; Vite now owns `/api/login`, a minimal `/login` route, and standalone app-route password-gate enforcement; browser tests cover sensitive session content not leaking into public scope. | Login prompt polish, return-to-reader sign-in flow, link-preview behavior under the gate, and broader session-expiry invalidation tests. | Privacy-sensitive. Required before any authenticated pilot. |
| Offline/cache controls | OPFS persistence, browser storage estimate, cache quota pressure messaging, explicit local cache reset, manual cache warming, versioned reader cache invalidation, stale-content explanation, failed body fetch metrics, and current-page retry UI exist. | Cache pruning/eviction policy for very large sites. | Required before production trial. |
| Performance instrumentation | Metrics panel tracks manifest bytes, markdown bytes, event count, OPFS usage/quota pressure, sync state, route render timing, warm render timing, failed body fetch count, screenshot-backed desktop/mobile visual baselines, current-route-first network assertions, and build-time bundle budgets. | Preview telemetry and broader per-route network assertions. | Required before migration decision. |
| Metadata/minimal SSR | Standalone Bun server injects public page title, description, and OG tags into the built Vite HTML shell before serving route pages. | Link-preview bot coverage, authenticated metadata behavior, canonical URLs, and production cache headers. | Keep this server render intentionally tiny; do not reintroduce full React SSR unless the evidence says we need it. |
| Deployment/ops | Local one-server dev loop exists, origin env docs exist, cross-origin API credentials are wired, backend allowlist CORS exists, optional preview smoke config exists, and the standalone server now verifies page-specific title injection. | Vercel app/service wiring, real preview URL, preview env values, CI wiring for the smoke test, and rollback story. | Required before reviewers can test without local setup. |

## Playwright Migration Status

The Vite app now has a local Playwright suite with matching filenames for every current `web/e2e/*.spec.ts` file. This keeps the migration inventory reviewable while letting the prototype enforce the behavior it actually owns.

Active Vite reader coverage:

- Initial shell, sidebar, mobile bottom navigation, metrics panel, and no dev error overlay.
- Local page finder, tag palette, recent-page palette, and public/session separation for `sensitive` pages.
- Command palette debug/cache tools for warming, resetting, and toggling local LiveStore devtools.
- Sidebar navigation through wiki pages, source markdown pages, and PDF asset links.
- Image theater behavior for client-rendered markdown images.
- Heading anchors, copied section links, same-page hash scrolling, cross-page hash navigation, and non-hash scroll reset.
- Smart table rendering, expansion/collapse, styling preservation, mobile fallback, and a light responsiveness check.
- Client-safe Mermaid timeline fallback rendering.
- Backend-owned text search and AI search from the Vite `/search` route.
- Full chat route loading, header navigation into chat, a live composer send/stream path, and Vite `/api/chat` validation.
- Warm navigation from cached LiveStore page bodies without a priority page-body refetch.
- Cold route priority fetching for the visible page body before eager markdown warming.
- Unknown deep links after manifest sync and current-page markdown fetch retry.
- Source routes and command-palette page navigation rendering without the old Next source-loading boundary.

Skipped-in-place migration inventory:

- P0 metadata browser placeholders: production metadata hardening is now covered by standalone smoke; decide whether to convert `metadata.spec.ts` into a standalone harness or delete the dev-server placeholder.
- P0 chat navigation resilience: server-side abort, navigation/refresh resume, mobile history navigation, and failed-stream recovery still need deeper browser coverage.
- P1 auth polish: login redirect hash preservation and broader session-expiry handling.
- Parked backlog: comments, Liveblocks, comment APIs, and the full comments rail.

Audit coverage holes to close next:

- Fixture-only sidebar tests are insufficient. Add live-manifest tests that reset the Vite OPFS store and assert the real tree hides image-only directories.
- Table tests are insufficient. Port the richer web table-expansion cases and run them against a real table-heavy page, not just synthetic fixture markdown.
- Right-rail tests are insufficient. Add outline rail collapse/resize tests before comments return, because table expansion depends on the right rail even when comments are parked.
- Cold-load tests are insufficient. Add clean browser contexts that do not share the warmed in-app OPFS store and assert route body fetch/manifest fallback behavior under backend errors.
- Visual parity is too narrow. Add desktop/mobile snapshots across reader, source, table, search, chat, and PDF routes and compare to the current app before accepting the replacement.

Current local result:

```txt
bun --cwd apps/wiki-vite test:e2e --reporter=line
105 passed, 49 skipped
```

The skipped specs are not a hidden success condition. They are the remaining feature inventory to either migrate into Vite, keep routed to Next for v1, or delete from the Vite migration scope explicitly.

## Current Shape

The branch now has four layers plus the next shell boundary:

1. `@diana-tnbc/wiki-content/server` owns the framework-neutral reader API logic, with `web` and Vite supplying adapters.
2. `packages/wiki-content` owns the shared content contracts: manifests, compact trees, page batches, store ids, and hash reconciliation.
3. `packages/wiki-markdown` owns the shared markdown runtime: wikilinks, citations, math cleanup, server HTML transforms, client markdown rendering, heading anchors, image theater, and smart-table enhancement.
4. `packages/wiki-shell` owns the first reusable Diana reader shell slice: right rail/outline, layout rail collapse/resize state, shared outline helpers, header chrome primitives, shell CSS, and the smart-table rail event contract. It should grow next to include page chrome, sidebar/mobile navigation visuals, shared theme/prose CSS, loading states, and visual interaction primitives.
5. `apps/wiki-vite` is the reader framework adapter plus local dev backend: Vite, React Router, LiveStore provider, OPFS persistence, fetch scheduling, local queries, Diana-style shell, and Vite middleware for reader APIs.

The important review property is that the final framework change is small. Most wiki behavior now lives in packages; the Vite app supplies LiveStore data, React Router navigation, and the one-server API adapter, while the old Next app remains the reference implementation until parity and deployment checks are complete.

## What Landed

- Root workspace support for `apps/*` and the runnable `apps/wiki-vite` prototype.
- Shared PII redaction and chat page-reading helpers in `packages/wiki-content`, with `web` reduced to compatibility wrappers for the old import paths.
- Local-only LiveStore cache with OPFS-backed persisted tables for site state, page index, page content, asset index, and file tree.
- Public/session store separation via server-issued session cache keys.
- Versioned reader cache ids so future OPFS-breaking changes can intentionally invalidate local stores.
- API surface in `web`: thin `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages` adapters, plus existing priority fetch through `/api/page-copy`.
- Vite backend adapter for `/api/wiki/*`, `/api/search`, `/api/tools`, `/api/file`, and `/api/page-copy` so reader development can run without a second Next dev server.
- Vite backend routes and UI surfaces for `/api/ai-search`, `/api/chat`, `/search`, `/chat`, and `/chat/:id`.
- Standalone Bun server for full-stack rehearsal after `apps/wiki-vite` builds.
- Eager markdown scheduling: current route first, then visible/sidebar-linked pages, recent pages, and bounded idle batches.
- Stale-content behavior: manifest hash reconciliation marks local content stale/deleted/missing without blocking the route shell.
- Bundle splitting: the entry resolves only scope/session identity; LiveStore and markdown rendering are lazy-loaded behind separate chunks.
- Bundle budget check for entry, vendor, markdown, LiveStore, worker, and SQLite assets.
- Shared markdown runtime extraction into `packages/wiki-markdown`, with Next and Vite reduced to adapters.
- Shared shell extraction into `packages/wiki-shell`, with Vite now consuming the shared right rail/outline and resizable layout primitives.
- Migrated Playwright harness in `apps/wiki-vite/e2e`, with active reader parity tests and skipped Next-owned feature inventory.
- Optional preview smoke harness in `apps/wiki-vite/preview-e2e`, pointed at `PLAYWRIGHT_BASE_URL` and intended for deployed Vite previews.

## Productionization Phases

### Phase 1: Package Boundary Hardening

Keep this phase focused on moving reusable behavior out of `web`, not on changing routing.

- Add package-level tests for `renderWikiMarkdownHtml`, including smart-table markup, PDF chips, image theater attributes, citations, math cleanup, Mermaid fallback, and theme-paired images.
- Add package-level tests for `MarkdownHeadingAnchors` and `RoutedAnchorLinks` using a DOM runner, with route-adapter and notification fakes.
- Create `packages/wiki-shell` for shell UI that is currently duplicated between `web` and Vite. Start with the right rail/outline and resizable layout, then move header/page chrome, sidebar/mobile navigation visuals, shared prose/theme CSS, and loading states.
- Move any remaining framework-neutral markdown helpers out of `web/src/lib/*` into package subpaths.
- Keep `web` wrappers thin: cache wrapper, Next router/link adapter, notification adapter, Diana shell adapter, and table layout adapter.

Exit criteria: `web` markdown tests pass through package imports, package tests cover the moved behavior directly, and `bun --cwd web build` still succeeds.

### Phase 2: Reader Parity

Make the prototype useful enough to compare against the current site on real reading workflows.

- Fill gaps in `apps/wiki-vite` shell parity by consuming shared `wiki-shell` components: right rail/outline, resizable rails, header/action menu, page chrome, sidebar tree, bottom navigation, route title/meta behavior, source/PDF affordances, and mobile navigation polish.
- Reuse package components for headings, image theater, tables, citations, and route links rather than duplicating Vite-only behavior.
- Add Playwright tests for deep-link cold load, warm navigation without body fetch, stale-hash update indicator, command palette from local index, and public/session cache separation.
- Add a small route-network assertion that warm navigation does not fetch server-rendered HTML.

Exit criteria: the prototype can read normal wiki pages, source-linked pages, images, PDFs, tables, and heading links without falling back to Next-rendered HTML.

### Phase 3: Cache And Data Safety

Treat privacy and invalidation as release blockers, not UI polish.

- Keep `sensitive` as the only privacy concept. Do not introduce `hidden`.
- Confirm public manifests and page batches exclude sensitive pages.
- Confirm session manifests use private cache headers and a distinct LiveStore store id.
- Clear or invalidate the session store on auth failure, cache-version change, or session cache-key change.
- Add an explicit OPFS cache reset path and surface enough UI/debug state to understand which store is active.
- Keep manifest/page ETags stable across `generatedAt` drift and sensitive to content hash changes.

Exit criteria: public/session data cannot leak between stores, and stale/deleted/missing transitions are deterministic in unit and browser tests.

### Phase 4: Deployment Rehearsal

Deploy the prototype beside the Next app without changing production routes.

- Decide whether `apps/wiki-vite` deploys as a separate Vercel app, a Vercel service, or a preview-only artifact.
- Configure the API origin explicitly per environment instead of relying on localhost proxy defaults.
- Capture production-like metrics: manifest bytes, markdown bytes, cold route render, warm navigation render, LiveStore event count, OPFS estimate, and failed body fetches.
- Add a preview smoke route that loads the Vite reader against the standalone Vite API.

Exit criteria: reviewers can open a preview URL and compare the Vite reader against the same content source without local setup.

### Phase 5: Migration Decision

Only decide on production routing after the prototype has parity evidence.

- If Vite is adopted, keep `web` APIs and shared packages as the production content plane and move reader routes gradually.
- If Vite is not adopted, keep `packages/wiki-content` and `packages/wiki-markdown` and delete only the app-specific prototype.
- Full-text search, AI search, and chat have been explicitly pulled into the Vite path. Keep comments, Liveblocks, and any remaining download/comment management flows out of the production cut unless they are intentionally scoped into a later phase.

Exit criteria: the migration decision is based on measured navigation performance, cache safety, and reader parity rather than architecture preference alone.

## Review Strategy

Keep future commits in this order:

1. Shared package extraction or package tests.
2. Next adapters that prove the current app still uses the shared package.
3. Vite adapter changes.

That shape makes the framework delta obvious. A reviewer should be able to see that `apps/wiki-vite` is mostly route/data glue and that the durable wiki behavior lives in packages.

## Verification Commands

Use the smallest focused check while iterating, then the full set before pushing:

```sh
bun run verify:wiki-vite

# Or run the pieces individually:
bun --cwd packages/wiki-markdown typecheck
bun --cwd packages/wiki-markdown test:unit
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
bun --cwd apps/wiki-vite check:bundle
bun --cwd apps/wiki-vite test:e2e
bun --cwd web typecheck
bun --cwd web build
bun run typecheck
bun run test:unit
```

Browser smoke targets for the current prototype:

```txt
http://127.0.0.1:60001/wiki/people/medical-team
http://127.0.0.1:60001/wiki/logistics/insurance
```

## Open Risks

- `packages/wiki-markdown` now owns a large amount of behavior but still inherits most of its regression coverage from `web` tests. Move the tests closer to the package before relying on it as a stable platform layer.
- The Vite app currently lazy-loads the markdown renderer, but `WikiPage` still carries a large page chunk. This is acceptable for the prototype; revisit once command palette and source/PDF parity land.
- OPFS behavior varies by browser and storage pressure. Keep cache reset and store introspection visible before any production trial.
- Session store separation depends on server-issued cache keys. Treat any change to `/api/wiki/session` as a privacy-sensitive change.
- The old Next app still owns useful behavioral reference coverage and some skipped feature surfaces. Treat deletion of `web` as blocked until deployment wiring, metadata, multi-site isolation, and the remaining full-stack parity inventory have current green checks in the Vite path.

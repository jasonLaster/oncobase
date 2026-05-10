# Vite + LiveStore Wiki Reader Plan

Status: replacement migration branch, updated 2026-05-09. Audience: reviewer, operator, and future migration owner.

## Goal

Build the Vite + LiveStore app into the standalone replacement for the current Next `web` app: load the route shell immediately, read cached markdown from LiveStore when available, refresh manifests and page bodies in the background, and make page-to-page navigation feel instant while preserving full-stack wiki functionality.

The target end state is that `apps/wiki-vite` plus shared packages own the production app and the old `web` directory can be deleted. Until parity is complete, `web` remains a reference implementation and compatibility source, but new migration work should avoid adding durable logic there.

## Migration Status Snapshot

The migration is far enough along to use the Vite one-server path as the primary implementation target, but it is not far enough along to delete `web` yet. The strongest next move is to keep moving backend/auth/full-stack behavior into Vite and shared packages while keeping `web` only as the behavioral reference until parity and deployment checks pass.

| Area | Status | Notes |
| --- | --- | --- |
| Shared content contracts | Mostly productionized | `packages/wiki-content` owns manifest parsing, compact tree expansion, page batches, content-hash reconciliation, versioned reader cache ids, public/session store ids, PII redaction, and chat page-reading helpers. Edge-case coverage now includes invalid manifests, pagination cursors, deleted/missing hash reconciliation, store-id sanitization/versioning, redaction behavior, and chat linked-page resolution. |
| Shared markdown runtime | Mostly productionized | `packages/wiki-markdown` owns the reusable renderer, route-link adapter, heading anchors, image theater, citations, math cleanup, PDF chips, theme-paired images, smart-table behavior, and a client-safe Mermaid fallback. The extraction is useful even if Vite is not adopted; package-level server coverage now protects the highest-risk renderer transforms. |
| Backend API surface | Vite-owned path expanding | `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages`, `/api/search`, `/api/ai-search`, `/api/chat`, `/api/tools`, and `/api/login` are served by the Vite backend. The reader API implementation now lives in `@diana-tnbc/wiki-content/server` with thin adapters, while the Vite backend also owns `/api/file` and `/api/page-copy` for one-server development. Vite now resolves the active site from `Host` and ignores injected `x-site-slug` headers, which is the right boundary for replacing the old Next proxy. |
| Convex support | Deployed additively | `documents.listManifestPage` is additive and mirrors existing document pagination without changing the publish path. Existing page and asset listing queries remain the source for markdown bodies and tree assets. The production Convex deployment now has the additive reader functions. |
| LiveStore reader | Prototype works | The Vite app persists page index, file tree, asset index, and page bodies in OPFS-backed LiveStore tables. It renders cached markdown first, fetches the manifest in the background, marks stale/deleted/missing content, eagerly fetches markdown in bounded batches, and surfaces storage pressure when browser quota is tight. |
| Reader UI parity | In progress | The current shell has a Diana-style layout, screenshot-backed desktop/mobile visual baselines, sidebar tree, mobile sheet, breadcrumbs, page actions, desktop/mobile outline, local title/slug/tag page finding, backend-powered text and AI search pages, a Vite-owned chat route with the shared full composer UI, command palette with pages/outline/assets/tags/recents/actions/debug-cache tools, sync metrics, stale indicators, not-found recovery, failed-fetch retry, and shared markdown rendering. It is still missing several product features listed below. |
| Privacy/cache safety | Stronger guardrails landed | Public and session scopes use separate cache headers and store ids; store ids include a reader cache version for intentional OPFS invalidation; sensitive pages stay out of public APIs. Browser coverage now verifies a session-only page body does not leak after switching back to the public store. |
| Playwright migration | Strong full-stack coverage | `apps/wiki-vite/e2e` now mirrors every current `web/e2e/*.spec.ts` filename. Reader-capable tests run locally against mocked `/api/wiki/*` responses and include screenshot-backed visual assertions plus current-route-first network assertions. The unmocked backend API spec exercises the Vite dev backend against Convex for session, manifest, text search, live AI search, chat tool calls, live chat streaming, login, and file validation behavior. The chat UI test sends a live message through `/api/chat` when credentials are configured and archives the test conversation afterward. Comments, Liveblocks, some metadata hardening, and multi-site invariants remain skipped in place so migration gaps stay visible. |
| Deployment | Standalone replacement target | The prototype has documented API/app origin env vars, cross-origin client credentials when an API origin is configured, backend allowlist CORS for preview origins, an optional Playwright preview smoke config, a Vite dev backend for reader APIs, and a standalone Bun server that serves the built app plus reader APIs from one origin. The standalone server now enforces the password gate for app routes before serving the Vite shell. The deployment target is now a standalone Vite replacement for `web`; remaining work is Vercel wiring, metadata hardening, and rollback. |
| Migration decision | Direction set | Vite is the intended replacement. Keep `web` only until auth, multi-site, metadata, full-stack features, cache policy, UI parity, and E2E coverage are good enough to delete it. |

## Work Log

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

#### P0: Replacement Blockers

These must be green before the Vite app can replace the current web app for production traffic.

| Area | Why it blocks cutover | Concrete work | E2E acceptance |
| --- | --- | --- | --- |
| Metadata hardening | The Vite app has minimal HTML patching, but production links, previews, indexing, and password-gated pages need predictable metadata without bringing back full React SSR. | Finish standalone server metadata for canonical URLs, OG/Twitter tags, robots policy, public bot access, authenticated page metadata, status codes, and cache headers. Keep the render tiny: page lookup plus HTML patching only. | Unskip `metadata.spec.ts`: authenticated page title/description, bot-safe metadata without login cookie, normal unauthenticated browser requests still gated. Decide whether `header-shell.spec.ts` is obsolete or should become a minimal-shell assertion. |
| Multi-site isolation | The replacement app cannot assume Diana-only host/site data if `web` is going away. Host resolution, stores, search, chat, assets, and downloads all need site boundaries. | Add a deterministic synthetic-site fixture or dev seeding helper; resolve site only from Host/config; ensure LiveStore store ids include site and session cache identity; route every backend call through site-scoped gateways; remove Diana fallbacks except explicit local-dev defaults. | Unskip `multi-site-isolation.spec.ts`: same slug isolation cold/warm, injected header ignored, text/AI search scoped, tools/chat scoped, files/page-copy/downloads scoped, unknown assets 404, non-enabled feature routes fail closed. |
| PII parity | The current app relies on publish-time redaction plus runtime safeguards. The replacement cannot leak identifiers through markdown, search, AI search, chat citations, or downloads. | Make redaction expectations explicit in shared package tests and Vite API tests; keep `showPII` from bypassing publish-time redaction; route search/AI/chat/page-copy through the same redacted document reads; add fixture content with known fake identifiers. | Unskip `pii-redaction.spec.ts`: rendered pages redacted, inline patient references redacted, text search excludes identifiers, markdown downloads remain redacted, AI search/chat cannot cite raw identifiers. |
| Chat resilience and performance | Basic live chat works, but production chat needs durable behavior when users stop, navigate, refresh, or switch conversations. | Wire server-side abort to model cancellation and Convex streaming cleanup; prove conversation persistence/resume; restore mobile history navigation; expose perf marks/buffer in Vite; prevent test conversations and failed streams from polluting the active list. | Unskip `chat-nav-resilience.spec.ts`, `chat-perf.spec.ts`, and the mobile chat navigation test: stop aborts server-side, navigate away/return shows assistant output, refresh mid-stream remains observable, composer perf buffer exists, mobile sheet can navigate history. |
| Deployment and ops | Local one-server success is not enough to delete `web`; the replacement needs a deploy target, env wiring, CI checks, and rollback. | Configure Vercel standalone/service deployment, env vars, Convex deployment target, preview smoke, production smoke, cache headers, logging, and rollback notes. Keep `verify:wiki-vite` in CI for the replacement path. | Preview URL passes standalone smoke, metadata smoke, backend API smoke, and core reader/search/chat e2e against the deployed Convex backend. |

#### P1: Parity And Polish

These should land before a broad user-facing rollout, but they can follow the P0 safety work if needed.

| Area | Work | Acceptance |
| --- | --- | --- |
| Auth/session UX | Polish login screen, return-to-reader flow, hash preservation, expired session recovery, and authenticated/public scope copy. | Hash-preserving login redirect tests pass; session-expiry tests prove public fallback and private store clearing. |
| Downloads and file actions | Make page-copy/download/file actions standalone Vite-owned where still thin or inherited from old behavior. | Page markdown, source files, PDFs, and missing files are scoped and cache-safe in backend tests. |
| Search/AI result UX | Improve snippets, citations, empty/error states, keyboard navigation, and sensitive-session result handling. | Search route tests cover keyboard selection, AI citations, and session-only result boundaries. |
| Command palette and sidebar accessibility | Better fuzzy ranking, focus management, keyboard navigation, large tree behavior, and richer current-page actions. | Keyboard-only smoke covers palette modes, sidebar expansion, outline jumps, and asset actions. |
| Observability | Add route/API timings, chat first-token/full-completion measurements, failed fetch counters, and OPFS footprint to preview/prod logs or telemetry. | Preview report captures cold route, warm nav, manifest bytes, markdown bytes, chat latency, and search latency. |

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

- P0 metadata hardening: link-preview bots, authenticated metadata, canonical/cache behavior, and whether the old header-shell expectation should be retired or rewritten for minimal SSR.
- P0 multi-site isolation: same-slug content, hostile headers, text/AI search, tools/chat, files, downloads, and store separation.
- P0 PII parity: rendered markdown, text search, AI search, chat citations, and downloads stay redacted.
- P0 chat resilience/perf: server-side abort, navigation/refresh resume, mobile history navigation, and perf marks.
- P1 auth polish: login redirect hash preservation and broader session-expiry handling.
- Parked backlog: comments, Liveblocks, comment APIs, and the full comments rail.

Current local result:

```txt
bun --cwd apps/wiki-vite test:e2e --reporter=line
80 passed, 68 skipped
```

The skipped specs are not a hidden success condition. They are the remaining feature inventory to either migrate into Vite, keep routed to Next for v1, or delete from the Vite migration scope explicitly.

## Current Shape

The branch now has four layers:

1. `@diana-tnbc/wiki-content/server` owns the framework-neutral reader API logic, with `web` and Vite supplying adapters.
2. `packages/wiki-content` owns the shared content contracts: manifests, compact trees, page batches, store ids, and hash reconciliation.
3. `packages/wiki-markdown` owns the shared markdown runtime: wikilinks, citations, math cleanup, server HTML transforms, client markdown rendering, heading anchors, image theater, and smart-table enhancement.
4. `apps/wiki-vite` is the reader framework adapter plus local dev backend: Vite, React Router, LiveStore provider, OPFS persistence, fetch scheduling, local queries, Diana-style shell, and Vite middleware for reader APIs.

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
- Migrated Playwright harness in `apps/wiki-vite/e2e`, with active reader parity tests and skipped Next-owned feature inventory.
- Optional preview smoke harness in `apps/wiki-vite/preview-e2e`, pointed at `PLAYWRIGHT_BASE_URL` and intended for deployed Vite previews.

## Productionization Phases

### Phase 1: Package Boundary Hardening

Keep this phase focused on moving reusable behavior out of `web`, not on changing routing.

- Add package-level tests for `renderWikiMarkdownHtml`, including smart-table markup, PDF chips, image theater attributes, citations, math cleanup, Mermaid fallback, and theme-paired images.
- Add package-level tests for `MarkdownHeadingAnchors` and `RoutedAnchorLinks` using a DOM runner, with route-adapter and notification fakes.
- Move any remaining framework-neutral markdown helpers out of `web/src/lib/*` into package subpaths.
- Keep `web` wrappers thin: cache wrapper, Next router/link adapter, notification adapter, Diana table layout adapter.

Exit criteria: `web` markdown tests pass through package imports, package tests cover the moved behavior directly, and `bun --cwd web build` still succeeds.

### Phase 2: Reader Parity

Make the prototype useful enough to compare against the current site on real reading workflows.

- Fill gaps in `apps/wiki-vite` shell parity: command palette, route title/meta behavior, sidebar tree affordances, source/PDF affordances, and mobile navigation polish.
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

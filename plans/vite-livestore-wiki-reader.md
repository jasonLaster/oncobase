# Vite + LiveStore Wiki Reader Plan

Status: prototype branch, updated 2026-05-09. Audience: reviewer, operator, and future migration owner.

## Goal

Build a side-by-side reader that proves wiki navigation can become mostly client-local: load the route shell immediately, read cached markdown from LiveStore when available, refresh manifests and page bodies in the background, and make page-to-page navigation feel instant without replacing the current Next app.

This plan is deliberately narrower than a production migration. The existing `web` app remains the content source, publish target, auth boundary, and production route owner until the prototype proves the runtime path and the remaining gaps below are closed.

## Migration Status Snapshot

The migration is far enough along to test the new data path against a deployed backend, but it is not far enough along to replace the current Next reader. The strongest next move is to deploy the additive manifest/page APIs and Convex query support, then run the Vite reader against production-like content from a separate preview.

| Area | Status | Notes |
| --- | --- | --- |
| Shared content contracts | Mostly productionized | `packages/wiki-content` owns manifest parsing, compact tree expansion, page batches, content-hash reconciliation, and public/session store ids. Edge-case coverage now includes invalid manifests, pagination cursors, deleted/missing hash reconciliation, and store-id sanitization. |
| Shared markdown runtime | Mostly productionized | `packages/wiki-markdown` owns the reusable renderer, route-link adapter, heading anchors, image theater, citations, math cleanup, PDF chips, theme-paired images, and smart-table behavior. The extraction is useful even if Vite is not adopted; package-level server coverage now protects the highest-risk renderer transforms. |
| Backend API surface | Ready for additive deployment rehearsal | `/api/wiki/session`, `/api/wiki/manifest`, and `/api/wiki/pages` are additive. They do not reroute existing pages, and public/session cache behavior is covered by API tests. The manifest route can use the new Convex metadata query when deployed and can fall back to content-backed metadata while the backend rolls out. |
| Convex support | Ready to deploy if kept additive | `documents.listManifestPage` is additive and mirrors existing document pagination without changing the publish path. Existing page and asset listing queries remain the source for markdown bodies and tree assets. Deploying this lets the manifest endpoint avoid shipping markdown just to compute metadata. |
| LiveStore reader | Prototype works | The Vite app persists page index, file tree, asset index, and page bodies in OPFS-backed LiveStore tables. It renders cached markdown first, fetches the manifest in the background, marks stale/deleted/missing content, and eagerly fetches markdown in bounded batches. |
| Reader UI parity | In progress | The current shell has a Diana-style layout, sidebar tree, mobile sheet, breadcrumbs, page actions, persistent outline rail, local title/slug/tag page finding, command palette, backend search/chat handoffs, sync metrics, stale indicators, not-found recovery, failed-fetch retry, and shared markdown rendering. It is still missing several product features listed below. |
| Privacy/cache safety | Initial guardrails landed | Public and session scopes use separate cache headers and store ids; sensitive pages stay out of public APIs. Before any real pilot, add browser-level leak tests across public/session stores and a visible cache reset/store inspector. |
| Playwright migration | Harness landed | `apps/wiki-vite/e2e` now mirrors every current `web/e2e/*.spec.ts` filename. Reader-capable tests run locally against mocked `/api/wiki/*` responses; Next-owned feature specs are skipped in place so migration gaps stay visible. |
| Deployment | Not started | The prototype still assumes local/dev wiring. It needs an explicit deployment target, API origin configuration, and preview smoke tests before wider review. |
| Migration decision | Not ready | The branch is ready to validate the architecture, not to replace the Next app. Keep production routes on Next until reader parity, privacy tests, and preview metrics are in hand. |

## Work Log

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

Latest result: `47 passed, 72 skipped` for the Vite Playwright suite.

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

| Feature area | Current prototype | Missing work | V1 stance |
| --- | --- | --- | --- |
| Page finder | Header finder filters the local page index by title, slug, and tags. The command palette now provides keyboard page navigation from the local LiveStore index. | Better fuzzy scoring, source/PDF actions, tag slices, richer empty states, and public/session leak tests. | Keep this client-local because it is a navigation affordance backed by the manifest, not canonical search. |
| Text search | Vite links to the existing backend search surface from the header and action palette. | Snippet/result handoff polish, active query transfer from the local finder, loading/empty/error parity in the backend app, and public/session leak tests. | Keep canonical full-text search on the backend for v1. The Vite reader should not rebuild search from the local markdown cache. |
| Chat | Vite links to the existing full-stack chat experience from the header and action palette. | Preserve return-to-reader context, conversation resumption handoff, and mobile polish. | Keep chat as a full-stack backend/app experience for v1 unless the migration scope explicitly changes. Link out or route users back to the current app. |
| AI search | Not implemented in Vite. | `/api/ai-search` route handoff or thin client adapter, citation rendering, loading states, and tenant/session scoping tests. | Keep AI search on the backend/full-stack search surface for v1. Do not block the reader prototype on it. |
| Outline | Local outline palette and persistent desktop outline rail extract headings from rendered markdown and jump by hash. | Mobile outline placement, hash navigation polish, and accessibility pass. | Should land before reader parity because it is a core reading affordance and can be fully local. |
| Comments and Liveblocks | Not implemented in Vite. | Comment rail, auth gating, Liveblocks tokens, thread persistence, unread/resolved states, and multi-device sync. | Keep in Next for v1. Treat as out of scope unless explicitly pulled forward. |
| Command palette | Keyboard trigger, local page rows, outline rows, and backend action rows landed. | Better fuzzy ranking, current-page context actions, recents surfacing, tags, source/PDF actions, and a deeper focus/accessibility pass. | Build before production reader parity. It can be powered by the local LiveStore index, while search/chat actions delegate to backend surfaces. |
| Other palettes | Page, outline, asset, and backend action palettes now exist as modes in one command surface. | Dedicated tag palette, recent-pages palette, and debug/cache palette for store reset and metrics. | Page palette should be first. Backend search/chat entries should delegate instead of cloning those full-stack flows. |
| Sidebar/tree | Desktop tree and mobile sheet exist, active branches auto-expand, manual expansion persists across reloads, and PDF/file assets are discoverable through the local asset palette. | Richer source grouping, keyboard navigation, and very large tree performance. | Needed before broad preview review, but not before additive backend deployment. |
| Page chrome | Title, description, breadcrumbs, tags, copy/link/print/download/main-app actions, size, stale/sensitive badges, not-found recovery, failed-fetch retry, and manifest/hash footer exist. | Source/PDF provenance, edit/source provenance, and richer mobile action placement. | Reader parity blocker for pages with sources/assets. |
| Markdown parity | Shared package handles the main rendering path. | More package tests for smart tables, citations, PDF/image rewriting, theme-paired images, heading anchors, math, Mermaid fallback, and route-link adapters. | Required before trusting the package as the durable reader layer. |
| Auth/session UX | Scope can be selected with `?scope=session` or the header switcher; session identity creates a distinct store id; signed-out session access shows a recovery screen; auth-expired fetches clear the session store. | Login prompt polish, return-to-reader sign-in flow, and deeper safe session-store invalidation tests. | Privacy-sensitive. Required before any authenticated pilot. |
| Offline/cache controls | OPFS persistence, browser storage estimate, explicit local cache reset, manual cache warming, stale-content explanation, failed body fetch metrics, and current-page retry UI exist. | Storage pressure behavior and versioned cache invalidation. | Required before production trial. |
| Performance instrumentation | Metrics panel tracks manifest bytes, markdown bytes, event count, OPFS estimate, sync state, route render timing, warm render timing, and failed body fetch count. | Bundle budget reporting, preview telemetry, and richer per-route network assertions. | Required before migration decision. |
| Deployment/ops | Local app runs side by side. | Separate Vercel app/service decision, API origin config, CORS/auth expectations if cross-origin, preview smoke target, environment docs, and rollback story. | Required before reviewers can test without local setup. |

## Playwright Migration Status

The Vite app now has a local Playwright suite with matching filenames for every current `web/e2e/*.spec.ts` file. This keeps the migration inventory reviewable while letting the prototype enforce the behavior it actually owns.

Active Vite reader coverage:

- Initial shell, sidebar, mobile bottom navigation, metrics panel, and no dev error overlay.
- Local page finder, including public/session separation for `sensitive` pages.
- Sidebar navigation through wiki pages, source markdown pages, and PDF asset links.
- Image theater behavior for client-rendered markdown images.
- Heading anchors, copied section links, same-page hash scrolling, cross-page hash navigation, and non-hash scroll reset.
- Smart table rendering, expansion/collapse, styling preservation, mobile fallback, and a light responsiveness check.
- Warm navigation from cached LiveStore page bodies without a priority page-body refetch.
- Unknown deep links after manifest sync and current-page markdown fetch retry.
- Source routes rendering as normal markdown pages without the old Next source-loading boundary.

Skipped-in-place migration inventory:

- Backend text search and AI search modes.
- Chat and chat performance/resilience.
- Comments, Liveblocks, comment APIs, and the full comments/outline rail.
- Server/link-preview metadata and login redirect behavior.
- Multi-site backend isolation invariants.
- PII redaction and markdown download backend checks.
- Server-rendered header shell before hydration.
- Mermaid timeline rendering.

Current local result:

```txt
bun --cwd apps/wiki-vite test:e2e --reporter=line
47 passed, 72 skipped
```

The skipped specs are not a hidden success condition. They are the remaining feature inventory to either migrate into Vite, keep routed to Next for v1, or delete from the Vite migration scope explicitly.

## Current Shape

The branch now has four layers:

1. `web` exposes the content APIs and keeps the existing Convex/publish/cache contracts.
2. `packages/wiki-content` owns the shared content contracts: manifests, compact trees, page batches, store ids, and hash reconciliation.
3. `packages/wiki-markdown` owns the shared markdown runtime: wikilinks, citations, math cleanup, server HTML transforms, client markdown rendering, heading anchors, image theater, and smart-table enhancement.
4. `apps/wiki-vite` is only the framework adapter: Vite, React Router, LiveStore provider, OPFS persistence, fetch scheduling, local queries, and the Diana-style shell.

The important review property is that the final framework change is small. Most wiki behavior now lives in packages; the Vite app supplies LiveStore data and React Router navigation, while the Next app supplies server caching, `next/link`, `next/navigation`, and Sonner toasts.

## What Landed

- Root workspace support for `apps/*` and the runnable `apps/wiki-vite` prototype.
- Local-only LiveStore cache with OPFS-backed persisted tables for site state, page index, page content, asset index, and file tree.
- Public/session store separation via server-issued session cache keys.
- API surface in `web`: `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages`, plus existing priority fetch through `/api/page-copy`.
- Eager markdown scheduling: current route first, then visible/sidebar-linked pages, recent pages, and bounded idle batches.
- Stale-content behavior: manifest hash reconciliation marks local content stale/deleted/missing without blocking the route shell.
- Bundle splitting: the entry resolves only scope/session identity; LiveStore and markdown rendering are lazy-loaded behind separate chunks.
- Shared markdown runtime extraction into `packages/wiki-markdown`, with Next and Vite reduced to adapters.
- Migrated Playwright harness in `apps/wiki-vite/e2e`, with active reader parity tests and skipped Next-owned feature inventory.

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
- Add a preview smoke route that loads the Vite reader against the preview `web` API.

Exit criteria: reviewers can open a preview URL and compare the Vite reader against the same content source without local setup.

### Phase 5: Migration Decision

Only decide on production routing after the prototype has parity evidence.

- If Vite is adopted, keep `web` APIs and shared packages as the production content plane and move reader routes gradually.
- If Vite is not adopted, keep `packages/wiki-content` and `packages/wiki-markdown` and delete only the app-specific prototype.
- Do not migrate full-text search, chat, comments, Liveblocks, downloads, or AI search into the Vite app unless they are explicitly pulled into a later phase. The Vite reader can expose entry points or thin clients for those backend/full-stack surfaces without owning their implementation.

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
bun --cwd packages/wiki-markdown typecheck
bun --cwd packages/wiki-markdown test:unit
bun --cwd apps/wiki-vite typecheck
bun --cwd apps/wiki-vite build
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
- The prototype still depends on the current Next app for content APIs. That is intentional for v1 and should not be treated as a blocker unless a deployment target cannot reach those APIs.

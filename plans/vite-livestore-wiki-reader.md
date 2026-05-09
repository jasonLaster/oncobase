# Vite + LiveStore Wiki Reader Plan

Status: prototype branch, updated 2026-05-09. Audience: reviewer, operator, and future migration owner.

## Goal

Build a side-by-side reader that proves wiki navigation can become mostly client-local: load the route shell immediately, read cached markdown from LiveStore when available, refresh manifests and page bodies in the background, and make page-to-page navigation feel instant without replacing the current Next app.

This plan is deliberately narrower than a production migration. The existing `web` app remains the content source, publish target, auth boundary, and production route owner until the prototype proves the runtime path and the remaining gaps below are closed.

## Migration Status Snapshot

The migration is far enough along to test the new data path against a deployed backend, but it is not far enough along to replace the current Next reader. The strongest next move is to deploy the additive manifest/page APIs and Convex query support, then run the Vite reader against production-like content from a separate preview.

| Area | Status | Notes |
| --- | --- | --- |
| Shared content contracts | Mostly landed | `packages/wiki-content` owns manifest parsing, compact tree expansion, page batches, content-hash reconciliation, and public/session store ids. Needs broader edge-case tests before it becomes a stable package API. |
| Shared markdown runtime | Partly productionized | `packages/wiki-markdown` owns the reusable renderer, route-link adapter, heading anchors, image theater, citations, math cleanup, and smart-table behavior. The extraction is useful even if Vite is not adopted, but package-level regression coverage still needs to catch up. |
| Backend API surface | Ready for additive deployment rehearsal | `/api/wiki/session`, `/api/wiki/manifest`, and `/api/wiki/pages` are additive. They do not reroute existing pages, and public/session cache behavior is covered by API tests. The manifest route can use the new Convex metadata query when deployed and can fall back to content-backed metadata while the backend rolls out. |
| Convex support | Ready to deploy if kept additive | `documents.listManifestPage` is additive and mirrors existing document pagination without changing the publish path. Existing page and asset listing queries remain the source for markdown bodies and tree assets. Deploying this lets the manifest endpoint avoid shipping markdown just to compute metadata. |
| LiveStore reader | Prototype works | The Vite app persists page index, file tree, asset index, and page bodies in OPFS-backed LiveStore tables. It renders cached markdown first, fetches the manifest in the background, marks stale/deleted/missing content, and eagerly fetches markdown in bounded batches. |
| Reader UI parity | Incomplete | The current shell has a Diana-style layout, sidebar tree, mobile sheet, local title/slug/tag page finding, sync metrics, stale indicators, and shared markdown rendering. It is still missing several product features listed below. |
| Privacy/cache safety | Initial guardrails landed | Public and session scopes use separate cache headers and store ids; sensitive pages stay out of public APIs. Before any real pilot, add browser-level leak tests across public/session stores and a visible cache reset/store inspector. |
| Playwright migration | Harness landed | `apps/wiki-vite/e2e` now mirrors every current `web/e2e/*.spec.ts` filename. Reader-capable tests run locally against mocked `/api/wiki/*` responses; Next-owned feature specs are skipped in place so migration gaps stay visible. |
| Deployment | Not started | The prototype still assumes local/dev wiring. It needs an explicit deployment target, API origin configuration, and preview smoke tests before wider review. |
| Migration decision | Not ready | The branch is ready to validate the architecture, not to replace the Next app. Keep production routes on Next until reader parity, privacy tests, and preview metrics are in hand. |

## Work Log

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
| Page finder | Header finder filters the local page index by title, slug, and tags. | Fuzzy ranking, keyboard palette presentation, recent pages, tag/source/PDF actions, better empty states, and public/session leak tests. | Keep this client-local because it is a navigation affordance backed by the manifest, not canonical search. |
| Text search | Not implemented in Vite. | Thin integration to the existing backend search surface, search route handoff, snippets/highlights, result grouping, loading/empty/error states, and public/session leak tests. | Keep canonical full-text search on the backend for v1. The Vite reader can call or link to the backend route later, but should not rebuild search from the local markdown cache. |
| Chat | Not implemented in Vite. | Entry point handoff to the existing full-stack chat experience, including conversation persistence/resumption, streaming UI, tool calls, citations, site/session scoping, quota/error states, and mobile behavior. | Keep chat as a full-stack backend/app experience for v1 unless the migration scope explicitly changes. Link out or route users back to the current app. |
| AI search | Not implemented in Vite. | `/api/ai-search` route handoff or thin client adapter, citation rendering, loading states, and tenant/session scoping tests. | Keep AI search on the backend/full-stack search surface for v1. Do not block the reader prototype on it. |
| Outline | Not implemented as a page rail. | Extract headings from rendered markdown or markdown AST, active-heading tracking, mobile outline placement, hash navigation polish, and accessibility. | Should land before reader parity because it is a core reading affordance and can be fully local. |
| Comments and Liveblocks | Not implemented in Vite. | Comment rail, auth gating, Liveblocks tokens, thread persistence, unread/resolved states, and multi-device sync. | Keep in Next for v1. Treat as out of scope unless explicitly pulled forward. |
| Command palette | The header finder handles the minimal page-switching path. | Keyboard trigger, fuzzy page ranking, action rows, current-page context actions, recents, tags, source/PDF actions, and robust focus management. | Build before production reader parity. It can be powered by the local LiveStore index, while search/chat actions delegate to backend surfaces. |
| Other palettes | Only the simple header finder exists. | Dedicated page palette, tag palette, asset/source palette, recent-pages palette, backend search action, chat action, and possibly a debug/cache palette for store reset and metrics. | Page palette should be first. Backend search/chat entries should delegate instead of cloning those full-stack flows. |
| Sidebar/tree | Basic desktop tree and mobile sheet exist. | Persisted expansion state, better active ancestor expansion, richer file/PDF affordances, source grouping, keyboard navigation, and very large tree performance. | Needed before broad preview review, but not before additive backend deployment. |
| Page chrome | Basic title, tags, size, stale/sensitive badges, manifest/hash footer. | Breadcrumbs, page description/meta, source links, PDF/download affordances, print/share/copy actions, edit/source provenance, not-found parity, and route metadata. | Reader parity blocker for pages with sources/assets. |
| Markdown parity | Shared package handles the main rendering path. | More package tests for smart tables, citations, PDF/image rewriting, theme-paired images, heading anchors, math, Mermaid fallback, and route-link adapters. | Required before trusting the package as the durable reader layer. |
| Auth/session UX | Scope is selected with `?scope=session`; session identity creates a distinct store id. | Login/session prompts, signed-out recovery, cache reset, active-store inspector, auth-expired handling, and safe session-store invalidation. | Privacy-sensitive. Required before any authenticated pilot. |
| Offline/cache controls | OPFS persistence and browser storage estimate exist. | Explicit reset, cache warming controls, stale content explanation, storage pressure behavior, versioned cache invalidation, and failed fetch retry UI. | Required before production trial. |
| Performance instrumentation | Metrics panel tracks manifest bytes, markdown bytes, event count, OPFS estimate, and sync state. | Cold/warm navigation timings, per-route network assertions, failed body fetch count, bundle budget reporting, and preview telemetry. | Required before migration decision. |
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
29 passed, 72 skipped
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

- Fill gaps in `apps/wiki-vite` shell parity: command palette, route title/meta behavior, page not found handling, sidebar tree affordances, source/PDF affordances, and mobile navigation polish.
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

# Vite + LiveStore Wiki Reader Plan

Status: prototype branch, updated 2026-05-09. Audience: reviewer, operator, and future migration owner.

## Goal

Build a side-by-side reader that proves wiki navigation can become mostly client-local: load the route shell immediately, read cached markdown from LiveStore when available, refresh manifests and page bodies in the background, and make page-to-page navigation feel instant without replacing the current Next app.

This plan is deliberately narrower than a production migration. The existing `web` app remains the content source, publish target, auth boundary, and production route owner until the prototype proves the runtime path and the remaining gaps below are closed.

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
- Do not migrate chat, comments, Liveblocks, downloads, or AI search into the Vite app unless they are explicitly pulled into a later phase.

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

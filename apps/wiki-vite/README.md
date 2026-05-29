# Vite + LiveStore Wiki Reader

This is a side-by-side prototype for a client-rendered wiki reader. It keeps the existing `apps/web` app as the content source and uses LiveStore as a persistent browser read cache for the file tree, page index, asset index, and markdown bodies.

The productionization plan lives in [`../../plans/vite-livestore-wiki-reader.md`](../../plans/vite-livestore-wiki-reader.md). This README describes how the current prototype runs.

## Run

Run the prototype:

```sh
cd apps/wiki-vite
bun run dev
```

By default the Vite dev server serves the reader APIs directly from Convex:

- `/api/wiki/session`
- `/api/wiki/manifest`
- `/api/wiki/pages`
- `/api/search`
- `/api/ai-search`
- `/api/chat`
- `/api/tools`
- `/api/login`
- `/api/download`
- `/api/file`
- `/api/page-copy`

This is the normal one-server development loop for the prototype. It uses `NEXT_PUBLIC_CONVEX_URL` or `CONVEX_URL` when set, and otherwise falls back to the current Diana Convex deployment. Set `WIKI_SITE_SLUG` to test a non-default site.

If you need to compare against the current Next route handlers instead, start the current Next app:

```sh
cd apps/web
bun run dev
```

Then run Vite with `VITE_WIKI_API_ORIGIN=http://localhost:3000` to proxy `/api/*` to Next.

Run the production-style one-process server after building:

```sh
cd apps/wiki-vite
bun run build
PORT=62003 bun run start:server
```

`start:server` serves `dist/` and the same wiki API request handler from one Bun process. It is the current full-stack rehearsal target: the SPA, `/api/wiki/*`, `/api/search`, `/api/ai-search`, `/api/chat`, `/api/tools`, `/api/login`, `/api/download`, `/api/file`, and `/api/page-copy` all come from the same origin while Convex remains the content database.

## Vercel

The standalone replacement has an isolated Vercel project named `diana-tnbc-wiki-vite`. The existing Next project remains `diana-tnbc` with Vercel root directory `apps/web`; the isolated Vite project is connected to the repo root and uses the root `vercel.json`.

The root Vercel config builds `apps/wiki-vite`, serves `apps/wiki-vite/dist`, and routes app HTML plus `/api/*` through Vercel Functions that call bundled versions of the same request handlers as `server/standalone.ts`. That keeps local standalone behavior and Vercel behavior aligned for password gate enforcement, route metadata, search, AI search, chat, downloads, files, and page-copy.

Current production smoke URL:

```sh
https://wiki-vite-zeta.vercel.app
```

Required project env vars:

- `NEXT_PUBLIC_CONVEX_URL`
- `CONVEX_URL`
- `VITE_CONVEX_URL`
- `VITE_NEXT_PUBLIC_CONVEX_URL`
- `WIKI_SITE_SLUG`
- `AI_GATEWAY_API_KEY`
- `OPENAI_API_KEY`

`WIKI_SITE_SLUG=diana` is currently required for the new `vercel.app` host because that host is not yet a site-domain record in Convex.

## Environment

The prototype has two origins:

- `VITE_WIKI_API_ORIGIN`: optional override for where `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages`, `/api/search`, `/api/ai-search`, `/api/chat`, `/api/tools`, `/api/login`, `/api/download`, `/api/page-copy`, and `/api/file` are served from.
- `VITE_WIKI_APP_ORIGIN`: optional app-origin override for routes that should intentionally leave the Vite app. Search, AI search, chat, and sign-in are Vite-owned in the standalone path.

For local dev, omit `VITE_WIKI_API_ORIGIN` to use the Vite backend. For a separate preview deployment that still calls the Next backend, set both origins to the deployed Next app origin. Cross-origin previews must also set `WIKI_VITE_ALLOWED_ORIGINS` on the Next app to the exact Vite preview origin so the additive wiki APIs can return credentialed CORS headers.

Session mode uses `credentials: include` when `VITE_WIKI_API_ORIGIN` is set. That keeps the public store usable without cookies and lets authenticated previews use the existing wiki session when the backend origin explicitly allows the Vite origin.

## Test

Run the migrated Playwright suite with mocked wiki APIs:

```sh
bun run test:e2e
```

Run the same suite on Endform's remote browser runners:

```sh
bun x endform login
bun run test:e2e:endform
```

Endform currently requires Node 22+. The script remains useful for targeted experiments, while the required PR browser suite runs as sharded Playwright jobs against the Vercel preview deployment.

Run the migrated Playwright suite against a deployed Vite reader:

```sh
PLAYWRIGHT_BASE_URL=https://wiki-vite-preview.example \
bun run test:e2e
```

When `PLAYWRIGHT_BASE_URL` is set, Playwright skips the local dev-server bootstrap and treats the URL as the app origin. For Vercel-protected previews, set `VERCEL_AUTOMATION_BYPASS_SECRET` so Playwright sends the Vercel bypass header and the Diana preview test-auth header with every request.

Run the optional preview smoke against a deployed Vite reader:

```sh
PLAYWRIGHT_BASE_URL=https://wiki-vite-preview.example \
WIKI_VITE_SMOKE_PATH=/wiki/logistics/insurance \
bun run test:e2e:preview
```

For password-gated deployments, set `WIKI_VITE_SMOKE_COOKIE` to an `authed=true` cookie from `/api/login` before running the preview smoke.

You can also run the preview smoke against the standalone server:

```sh
bun run build
PORT=62004 bun run start:server
PLAYWRIGHT_BASE_URL=http://127.0.0.1:62004 bun run test:e2e:preview
```

The suite mirrors the current `apps/web/e2e/*.spec.ts` filenames. Reader-capable and newly migrated full-stack specs run against the Vite app. P0 multi-site isolation, PII parity, and chat perf specs are active; standalone metadata hardening is covered by `verify:standalone` because production HTML patching is owned by the Bun server rather than the Vite dev server. Comments, Liveblocks, and deeper chat navigation resilience are labeled as backlog so they remain visible without blocking the standalone replacement path.

From the repository root, `bun run verify:wiki-vite` runs the current migration proof: static checks, unit checks, and the migrated Vite Playwright suite. `bun run verify:wiki-vite:static` runs lint, package/app typechecks, the Vite build, and the bundle budget. `bun run verify:wiki-vite:unit` runs the shared package and Vite app unit tests.

The PR workflow keeps those phases independent:

- `Vite Static` runs the static/lint/build/bundle phase.
- `Vite Unit` runs the shared package and Vite app unit tests.
- `Vite Server` runs the standalone Bun server smoke so metadata, gates, backend APIs, and single-origin preview behavior keep their existing coverage.
- `Vite E2E (Preview n/4)` resolves the branch's Vercel preview URL and runs the migrated Playwright suite in four preview shards.

`bun run verify:wiki-vite:server` builds the Vite reader, starts the standalone Bun server, checks the password gate, page-specific metadata, bot-safe canonical/OG tags, private/public cache headers, key backend APIs, and the preview smoke against that single origin, then stops the server.

The header finder is intentionally not the canonical wiki search. It filters the local manifest/page index for instant page switching. Canonical text search, AI search, and the full-stack chat experience are now served by the Vite backend/app surface for the standalone migration path.

## Scope

The default store is public-only, even if the browser also has a signed-in wiki session. Open `/?scope=session` to use authenticated content. Session mode first fetches `/api/wiki/session` and only opens LiveStore with a server-issued cache key for the current wiki session.

## Architecture Note

The prototype is intentionally side-by-side with the current Next app. `apps/web` remains the v1 content source and publishing target; this app only consumes public/session API snapshots and stores them in the browser.

The durable wiki behavior should stay in shared packages. `@diana-tnbc/wiki-content` owns manifest/page/tree contracts and cache reconciliation. `@diana-tnbc/wiki-markdown` owns markdown rendering, route-safe links, heading anchors, image theater (including light/dark `data-theme-pair` variants), citations, math, and smart-table integration. `@diana-tnbc/wiki-shell` owns the shared page chrome — `WikiPageHeader`, `WikiCopyPageButton`, the loading skeleton, the outline rail, sidebar, and theme controls — so this reader and the Next.js reader render an identical header from one source. The Vite app should remain the LiveStore and React Router adapter around those packages.

LiveStore is used as a local read cache without a remote sync backend. The schema stores:

- `siteState` for manifest metadata and sync timing.
- `fileTree`, `pageIndex`, and `assetIndex` for navigation, local page finding, and link rewriting.
- `pageContent` for fetched markdown bodies plus first-class `fresh`, `stale`, `missing`, and `deleted` states.

On load the app renders whatever markdown is already in LiveStore, fetches `/api/wiki/manifest` in the background, and lets the manifest materializer mark cached pages stale or deleted. Fetch priority is current route first through an explicit page fetch, then sidebar-linked pages, recent pages, and a bounded idle queue. The idle queue skips the current route so user-visible retry state is not raced by duplicate background fetches. The queue respects browser offline/save-data signals and caps eager work by page count and payload bytes.

Public and session data use separate LiveStore `storeId` values that include site, scope, origin, reader cache version, and session cache key. Public requests never ask for sensitive content; session requests use private cache headers, require the existing wiki session, and clear the local session cache on auth failure. The Vite backend also applies defense-in-depth PII redaction across page bodies, search, AI search, chat tools, page-copy, and downloads, even though Convex content should already be redacted at publish time.

## Bundle Shape

The entry bundle only resolves the public/session scope and asks the existing web app for `/api/wiki/session`. LiveStore startup is lazy-loaded after that identity is known, and the markdown page renderer is lazy-loaded inside the shell so the first paint does not pull in the markdown processor.

Vite/Rolldown code splitting keeps React, LiveStore, Effect, markdown, and icons in separate vendor chunks. Lazy chunk preloads are intentionally suppressed for `LiveStoreRoot` and `WikiPage`; otherwise the browser eagerly requests the expensive local database and markdown renderer before the wiki shell can render.

Run `bun run build && bun run check:bundle` before widening the reader surface. The bundle budget reports raw/gzip sizes for the entry, LiveStore, markdown, Effect, workers, and SQLite wasm chunks so tree-shaking regressions show up as a failing check instead of a visual review surprise.

## Observability

The reader keeps a small browser-local diagnostics buffer at `window.__WIKI_VITE_OBSERVABILITY__`. It exposes the latest route/cache metrics and recent search timings so Playwright and preview smoke tests can verify cold render, warm navigation, search latency, and cache pressure without relying only on visible UI text.

# Vite + LiveStore Wiki Reader

This is a side-by-side prototype for a client-rendered wiki reader. It keeps the existing `web` app as the content source and uses LiveStore as a persistent browser read cache for the file tree, page index, asset index, and markdown bodies.

The productionization plan lives in [`../../plans/vite-livestore-wiki-reader.md`](../../plans/vite-livestore-wiki-reader.md). This README describes how the current prototype runs.

## Run

Start the current Next app first:

```sh
cd web
bun run dev
```

Then run the prototype:

```sh
cd apps/wiki-vite
bun run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:3000` by default. Override with `VITE_WIKI_API_ORIGIN` if the Next app is on another port.

## Environment

The prototype has two origins:

- `VITE_WIKI_API_ORIGIN`: where `/api/wiki/session`, `/api/wiki/manifest`, `/api/wiki/pages`, `/api/page-copy`, and `/api/file` are served from.
- `VITE_WIKI_APP_ORIGIN`: where backend-owned UI handoffs should open, including search, chat, downloads, and sign-in.

For local dev both can be omitted when the Next app is on `http://localhost:3000`, because Vite proxies `/api/*` there. For a separate preview deployment, set both to the deployed Next app origin. Cross-origin previews must also set `WIKI_VITE_ALLOWED_ORIGINS` on the Next app to the exact Vite preview origin so the additive wiki APIs can return credentialed CORS headers.

Session mode uses `credentials: include` when `VITE_WIKI_API_ORIGIN` is set. That keeps the public store usable without cookies and lets authenticated previews use the existing wiki session when the backend origin explicitly allows the Vite origin.

## Test

Run the migrated Playwright suite with mocked wiki APIs:

```sh
bun run test:e2e
```

Run the optional preview smoke against a deployed Vite reader:

```sh
PLAYWRIGHT_BASE_URL=https://wiki-vite-preview.example \
WIKI_VITE_SMOKE_PATH=/wiki/logistics/insurance \
bun run test:e2e:preview
```

The suite mirrors the current `web/e2e/*.spec.ts` filenames. Reader-capable specs run against the Vite app; feature areas still owned by the Next app for v1 are skipped in place so the migration gap remains visible.

The header finder is intentionally not the canonical wiki search. It filters the local manifest/page index for instant page switching. Full-text search, AI search, and the full-stack chat experience stay on the existing backend/app surface for v1.

## Scope

The default store is public-only, even if the browser also has a signed-in wiki session. Open `/?scope=session` to use authenticated content. Session mode first fetches `/api/wiki/session` and only opens LiveStore with a server-issued cache key for the current wiki session.

## Architecture Note

The prototype is intentionally side-by-side with the current Next app. `web` remains the v1 content source and publishing target; this app only consumes public/session API snapshots and stores them in the browser.

The durable wiki behavior should stay in shared packages. `@diana-tnbc/wiki-content` owns manifest/page/tree contracts and cache reconciliation. `@diana-tnbc/wiki-markdown` owns markdown rendering, route-safe links, heading anchors, image theater, citations, math, and smart-table integration. The Vite app should remain the LiveStore and React Router adapter around those packages.

LiveStore is used as a local read cache without a remote sync backend. The schema stores:

- `siteState` for manifest metadata and sync timing.
- `fileTree`, `pageIndex`, and `assetIndex` for navigation, local page finding, and link rewriting.
- `pageContent` for fetched markdown bodies plus first-class `fresh`, `stale`, `missing`, and `deleted` states.

On load the app renders whatever markdown is already in LiveStore, fetches `/api/wiki/manifest` in the background, and lets the manifest materializer mark cached pages stale or deleted. Fetch priority is current route first, then sidebar-linked pages, recent pages, and a bounded idle queue. The queue respects browser offline/save-data signals and caps eager work by page count and payload bytes.

Public and session data use separate LiveStore `storeId` values. Public requests never ask for sensitive content; session requests use private cache headers, require the existing wiki session, and clear the local session cache on auth failure. The manifest API prefers the lightweight Convex manifest query; when that is not deployed yet, it may use an explicit content-backed metadata fallback that preserves hashes, sensitivity, and sizes. If reliable metadata cannot be produced, it returns `503` with `no-store` instead of disabling invalidation.

## Bundle Shape

The entry bundle only resolves the public/session scope and asks the existing web app for `/api/wiki/session`. LiveStore startup is lazy-loaded after that identity is known, and the markdown page renderer is lazy-loaded inside the shell so the first paint does not pull in the markdown processor.

Vite/Rolldown code splitting keeps React, LiveStore, Effect, markdown, and icons in separate vendor chunks. Lazy chunk preloads are intentionally suppressed for `LiveStoreRoot` and `WikiPage`; otherwise the browser eagerly requests the expensive local database and markdown renderer before the wiki shell can render.

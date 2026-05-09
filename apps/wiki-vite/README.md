# Vite + LiveStore Wiki Reader

This is a side-by-side prototype for a client-rendered wiki reader. It keeps the existing `web` app as the content source and uses LiveStore as a persistent browser read cache for the file tree, page index, asset index, and markdown bodies.

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

## Scope

The default store is public-only, even if the browser also has a signed-in wiki session. Open `/?scope=session` to use authenticated content. Session mode first fetches `/api/wiki/session` and only opens LiveStore with a server-issued cache key for the current wiki session.

## Architecture Note

The prototype is intentionally side-by-side with the current Next app. `web` remains the v1 content source and publishing target; this app only consumes public/session API snapshots and stores them in the browser.

LiveStore is used as a local read cache without a remote sync backend. The schema stores:

- `siteState` for manifest metadata and sync timing.
- `fileTree`, `pageIndex`, and `assetIndex` for navigation, search, and link rewriting.
- `pageContent` for fetched markdown bodies plus first-class `fresh`, `stale`, `missing`, and `deleted` states.

On load the app renders whatever markdown is already in LiveStore, fetches `/api/wiki/manifest` in the background, and lets the manifest materializer mark cached pages stale or deleted. Fetch priority is current route first, then sidebar-linked pages, recent pages, and a bounded idle queue. The queue respects browser offline/save-data signals and caps eager work by page count and payload bytes.

Public and session data use separate LiveStore `storeId` values. Public requests never ask for sensitive content; session requests use private cache headers, require the existing wiki session, and clear the local session cache on auth failure. The manifest API prefers the lightweight Convex manifest query; when that is not deployed yet, it may use an explicit content-backed metadata fallback that preserves hashes, sensitivity, and sizes. If reliable metadata cannot be produced, it returns `503` with `no-store` instead of disabling invalidation.

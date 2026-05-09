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

The default store is public-only, even if the browser also has a signed-in wiki session. Open `/?scope=session` to use a separate session store and request authenticated content.

## Architecture Note

The prototype is intentionally side-by-side with the current Next app. `web` remains the v1 content source and publishing target; this app only consumes public/session API snapshots and stores them in the browser.

LiveStore is used as a local read cache without a remote sync backend. The schema stores:

- `siteState` for manifest metadata and sync timing.
- `fileTree`, `pageIndex`, and `assetIndex` for navigation, search, and link rewriting.
- `pageContent` for fetched markdown bodies plus stale/missing state.

On load the app renders whatever markdown is already in LiveStore, fetches `/api/wiki/manifest` in the background, and marks cached pages stale when the manifest hash for that page changes. Fetch priority is current route first, then sidebar-linked pages, then the rest of the public index in idle batches.

Public and session data use separate LiveStore `storeId` values. Public requests never ask for sensitive content; session requests use private cache headers and require the existing wiki session.

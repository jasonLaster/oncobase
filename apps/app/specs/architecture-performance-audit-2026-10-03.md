# Architecture and performance audit (2026-10-03)

Evidence comes from 30 days of production spans in `oncobase-traces` (queried with `bun scripts/query-traces.ts --report`) plus reading the code: server, Convex, and client. "Total" is the serial-equivalent time (sum of span durations). Parallel spans overlap, so totals rank cost; they are not wall-clock time. Where a claim rests on code reading alone, it says so.

## Tracing added in this change

| Area | Signal | Why |
| --- | --- | --- |
| HTML shell | Convex RPC spans (the shell's client was never wrapped), phases `shell.init/gate/canonical/document/headers` | Most frequent origin request (17k/30d) had no visibility below the root span |
| Every request | `faas.coldstart`, `faas.init_ms`, `process.inflight_requests`, `nodejs.eventloop.utilization`, `convex.calls.failed`, `convex.rpc_sum_ms` | Separate cold starts, Fluid Compute concurrency and CPU saturation from route work |
| Failures | `error.type` (class name only) on request, RPC and phase spans | Failures were status-only, with no way to group them |
| Caches | `cache.<name>.hits/misses` for site-host, canonical-slugs, pii-patterns, search-corpus; `manifest-snapshot.potential` | Per-instance caches had unknown hit rates. The last counter sizes a cache that doesn't exist yet |
| Dependencies | `api.gate`, `external.blob`, `external.liveblocks`, `external.openai`, `external.ai-gateway`, `manifest.snapshot-encode` | Outbound and CPU time was previously unattributed "self time" |
| Manifest | `http.request.conditional` | Diagnoses why snapshot responses are never 304 (see P1) |
| Browser | `nav-document` (TTFB plus server time plus the server trace ID from `Server-Timing`), `vital-lcp`, `vital-tbt`, `vital-inp`, `route-render` (cached flag), `search-text`, `search-ai`; `request-*` spans now carry `server.duration_ms` | Web vitals, in-app navigation and search latency were local-only or not collected |
| Tooling | `query-traces.ts --report` | Seven schema-aware aggregate tables: latency, RPC by route, self time, platform, caches, failures, browser-vs-server gap |

Fixes made while instrumenting:
- The shell's lazy-import promise no longer caches a failed import for the life of the instance.
- `traceConvexClient` is idempotent, so the shell and its nested API router can't double-record RPCs.
- The page-hide flush now drains every batch instead of only the first 32 spans.

**Verify after deploy:**
1. Run `--report` and confirm the platform, cache and browser columns are populated. They are empty until then.
2. Check `manifest.snapshot-encode` against the 155 ms self-time gap described below.

## Where the time goes (30 days, production)

| Span | n | p50 | p95 | Total |
| --- | ---: | ---: | ---: | ---: |
| `wiki /api/wiki/manifest` | 54,474 | 322 ms | 816 ms | 26,241 s |
| `convex.query documents:getBySlug` (from `/api/liveblocks-threads`) | 3,990 | 3,605 ms | 3,903 ms | 14,291 s |
| `convex.query documents:listManifestPage` | 68,308 | 92 ms | 315 ms | 12,799 s |
| manifest self time (no child span) | 54,474 | 155 ms | 244 ms | 7,117 s |
| `manifest.snapshot-read` (Blob GET) | 51,266 | 89 ms | 177 ms | 5,402 s |
| `wiki /api/search` | 67 | 10.1 s | 16.6 s | 709 s |
| `reader.store-boot-complete` (browser) | 1,242 | 1.31 s | 2.52 s | — |
| `reader.reader-ready` (browser) | 1,111 | 682 ms | 1.91 s | — |

## 1. Performance: biggest opportunities

**P1. The manifest snapshot path redoes its full work on every request.** This is the largest server cost.
- Public snapshot hits (41k requests) take p50 322 ms. Traced children explain only about 140 ms:
  - Blob GET: 89 ms
  - `sites:getBySlug`: 33 ms
  - `manifestCache:current`: 17 ms
- The remaining ~155 ms is decode, compact, re-stringify and gzip of the same content-addressed snapshot (`packages/wiki-content/src/server.ts`, snapshot branch). It is now traced as `manifest.snapshot-encode`.
- **Fix:** keep a small in-memory LRU of `hash → compact gzip bytes`, or store the compact gzip form in the snapshot itself. That removes about 240 ms of origin work from a warm instance's hits.
- **Zero snapshot 304s.** All 41,124 snapshot responses were 200. The only 304s (1,630) came from the live path, at p50 2.7 s and p95 4.3 s: the full manifest is built just to compare hashes.
  - The client does send `If-None-Match: W/"<manifestHash>"`, and the snapshot hash *is* the manifestHash. So either the validator isn't reaching the origin (CDN or proxy) or the client's stored hash is stale.
  - `http.request.conditional` now separates these two cases.
- **Snapshot misses are expensive:** p50 2.6 s, p95 12.8 s, p99 21 s. Separately, 79 `bounded-content-fallback` responses took about 21 s each.
  - During a scoped publish, `manifestCache.current` returns null, so each reader request awaits `requestBuild`. `install()` then discards the build as `active-writer` (`convex/manifestCache.ts`), so builds repeat throughout the publish window.
  - **Fix:** make `requestBuild` fire-and-forget and skip it while a writer holds the lease.
- **About half of manifest traffic (27.7k of 54.5k) has no browser correlation ID.** Identify that caller (monitor, warmer, scripts or old clients) before optimizing for it.

**P2. Each `/api/liveblocks-threads` request makes about 798 full-document reads.** `filterPublicCommentRooms` (`server/wiki-api.ts`) calls `documents:getBySlug` once per comment room, in parallel, just to read `sensitive`.
- Those calls return `content`, `rawContent` and a 1536-float embedding.
- Requests take 5.9–6.6 s, and the RPCs make up the single largest Convex cost.
- **Fix:** one query returning `{slug, sensitive}` for a set of slugs, or store sensitivity on `commentRooms`.

**P3. Search is slow by construction.** `/api/search` p50 is 10.1 s and `search.corpus` p95 is 61 s.
- Session-scope search, which every signed-in user gets, downloads every document body. It then calls `canUserAccessSlug` **once per sensitive page, sequentially** (`filterAccessiblePages`, `server/wiki-api.ts`), with no cache.
- **Fix:** reuse the batched `accessBySlug` from `wiki-content/server.ts`, and overlay the user's allowed pages on the cached public corpus. Longer term, use a Convex search index or a prebuilt search snapshot like the manifest.
- AI search runs three **sequential** rounds of four LLM scoring calls (`server/ai-search.ts`). Running all candidates in parallel, or doing one structured call, removes two round trips. Each round is now traced as `external.ai-gateway`.

**P4. Convex document rows mix metadata with bodies.** Based on code reading:
- `documents` holds `content`, `rawContent` and a 1536-float embedding (about 12 KB) in one row.
- Convex can't project fields, so metadata-only queries read whole bodies: `listManifestPage` (68k calls), `filterAccessibleSlugs`, `listAllowedSensitive*`, `prefetch.priorities`, `sensitiveSiblingSlugSet`.
- **Fix:** split into a `documentMeta` table and a `documentBodies` table. This is the largest structural Convex win, and it removes read-limit failure risk.
- Also, `listPdfAssetVisibilityPage` loads the sibling doc for every sensitive asset even in public scope. If that page hits the read limit, the snapshot build fails as "incomplete" and every reader falls back to the live path.

**P5. The reader boot is a request waterfall.** The chain is entry → `WikiViteRoot` chunk → `/api/wiki/session` → LiveStore worker, shared worker and wasm → manifest/page.
- The `WikiViteRoot` chunk isn't preloaded (`reader-preload-plugin.ts` only preloads `LiveStoreRoot`'s imports).
- The LiveStore worker, shared worker and wasm are about 580 KB gzipped and are fetched only after identity resolves.
- The page body waits for the store, because `WikiSync` mounts after it.
- **Fix:** start the session and page fetches at the entry and pass the promises down; preload the chunks.
- `reader.store-boot-complete` p50 is 1.31 s. `disableFastPath: true` (`LiveStoreRoot.tsx`) deliberately avoids torn OPFS snapshots. Revisit it with a generation or checksum guard rather than simply turning the fast path back on.

**P6. One root `metrics` state re-renders the reader every 250 ms during transfers.** Based on code reading:
- `App.tsx` passes the whole object down.
- `MarkdownTitle` re-parses markdown, with inline component types, on each tick.
- `WikiMarkdown`'s `memo` never hits because of an inline `loadingFallback` element.
- **Fix:** split UI state from diagnostics, and read byte progress through `useSyncExternalStore` in the activity components only.

**P7. API cold start loads about 2.1 MiB of JS for every route.** Archiver, AI, OpenAI, Liveblocks and Blob are all static imports. Cold manifest p50 is 528 ms vs 322 ms warm.
- **Fix:** a route table with lazy feature loaders, plus a budget for the `/api/wiki/*` core (the HTML function already has one).

## 2. Complexity: what to delete or merge

- **About 1,220 lines of HTML-first and edge-reader code are unreachable in production:** `fast-reader`, `reader-edge-*`, `*-reader-policy-cache`, `encoded-reader-cache`, `stream-reader`, `html-page-cache`, `html-first-*`, `reader-navigation/sidebar/page-header/route`.
  - `root-app-shell.ts` hard-codes `htmlFirstExperiment: false`.
  - The edge middleware runs on **every** request only to strip two headers that no live code reads.
  - Deleting it removes an edge hop. The dead Convex `getReaderPage`/`getReaderPolicy` and the critical-CSS read go with it.
- **The route list exists four times:** the `handled` list, the gate-exempt list, the dispatch chain (all in the 3,464-line `wiki-api.ts`), and `TRACED_ROUTES`.
  - **Fix:** one table, `{path, load, gate, privatize}`, which also enables lazy loading (P7).
  - The natural split is auth, files, diagnostics/DICOM, share preview, download, search, tools, comments, admin, and router.
- **Duplicated helpers:**
  - `restoreRewrittenPath` exists twice and the copies already differ on the empty path.
  - The "slug or `slug/index`" lookup is written about four times.
  - There are three access-filter strategies: serial, batched `accessBySlug`, and an unused `loadAllowedSensitiveSlugs`.
- **The client has about seven overlapping caches:** HTML bootstrap, gzipped localStorage snapshot, public identity, LiveStore OPFS, in-memory seed maps, the reader-shell cookie, and dead first-frame code. Keep one presentation cache plus LiveStore.
- **Convex legacy unscoped fallbacks are dead.** `rowBelongsToSite` requires `siteId`, yet `findDocBySlug` and its siblings still do a second global lookup on every miss, and about 12 legacy indexes add write cost. Make `siteId` required.

## 3. Idiomatic patterns

- **React:**
  - `window` CustomEvents act as an app message bus (`RETRY_PAGE`, `REFRESH_MANIFEST`, …).
  - `WikiViteRoot` hand-rolls a module-loading state machine instead of using `lazy`/Suspense.
  - `WikiPage`'s `displayedRouteSlug` re-implements "keep old UI during a transition". `use(promise)` with React Router transitions provides that.
  - Effects push derived values up into `metrics`.
- **Convex:**
  - Reads go through actions (`getByTag`/`list` → `runAction` → `listPage` ×N); use queries with helpers instead.
  - Operator functions (`sites.create`, `addPublishToken`, `users.resetPassword`, `migrations.*`) are public service functions; they should be `internal*` and run via `convex run`.
  - `manifestCache`/`prefetch` authenticate with a shared-secret argument instead of the service identity.
- **Node adapter:**
  - `sendWebResponse` (`server/http-adapter.ts`) ignores `res.write` backpressure and client disconnects.
  - It drops all but the last `Set-Cookie`, because `Headers.forEach` yields each one separately; this is latent, as no route sets two cookies yet. Use `getSetCookie()`.
  - `readIncomingBody` buffers unbounded request bodies before route-level size limits run.

## 4. Robustness: likely bugs

- **Chat conversations are readable and deletable site-wide (high, security).**
  - `/api/wiki/convex-token` issues a site-scoped `wiki-browser:<site>` token to anyone past the gate, or to anyone at all on an ungated site.
  - Conversations have no owner, and `conversations.list/get/remove` authorize only the site.
  - Per code reading, answers generated with `includeSensitive` for signed-in users are stored there, so they can cross users.
  - **Fix:** add an owner and check it, and gate the token on `enableChat`.
- **Work outlives its response.** Spans show `listManifestPage` lasting up to 549 s and `listPageWithContent` up to 281 s, far past the 60 s `maxDuration`.
  - `withTimeout` races without aborting, and Vercel freezes the instance after the response.
  - Convex calls have no timeout at all (`backend-client.ts`).
  - **Fix:** `AbortSignal.timeout` in `authenticatedFetch`, cancel the losing work, and use `waitUntil` for intentional background work (`seedCommentRoomsInBackground`, the late public corpus load).
- **Mutations queue behind each other per instance.** `ConvexHttpClient` serializes mutations unless `skipQueue` is passed, and only three call sites pass it. So chat flushes, `recordVisit`, `requestBuild` and session creation wait on each other.
- **The `sites` row is a write-conflict (OCC) and reactivity hotspot.** Every function reads it, and publish/manifest bookkeeping writes it, once per document in legacy publishes. **Fix:** move the runtime fields to a `siteRuntime` table.
- **Stale content after publish on ungated sites.** `/api/wiki/pages` URLs carry no content version but are CDN-cached (`s-maxage=300, swr=3600`), so a fresh manifest can point at an old body. **Fix:** put `contentHash` in the URL, which also allows immutable caching.
- **The client has one error boundary,** and its fallback offers "Reset local data", which deletes OPFS, for any render error.
  - `readLiveStoreDevtoolsEnabled()` touches `localStorage` unguarded during render, so blocked storage crashes the reader into that card.
- **Publish lease is a fixed 10 minutes with no heartbeat.** Long scoped runs fail partway with partial writes.

## Suggested order

1. **Snapshot byte cache and the requestBuild fixes (P1).** These are small and cut the top server cost. Measure with `manifest.snapshot-encode` and `cache.manifest-snapshot.potential` first.
2. **Conversation ownership.** Security.
3. **Batched access checks** for comments, search and pages (P2, P3), plus Convex fetch timeouts.
4. **Delete the dead HTML-first and edge code;** introduce a route table with lazy loaders (P7, C2).
5. **`documentMeta` split (P4)** and the boot waterfall (P5). These are larger, so measure them with the new browser spans before and after.

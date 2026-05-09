# Page Rendering And Caching

This document is the contract for how wiki pages load, render, and
invalidate. It exists because this is the main performance lever for
two competing goals:

- readers should see useful page chrome and content quickly
- publishers should be able to publish without waiting for the whole
  wiki to rebuild

The app uses Next.js Cache Components with a mix of static pages,
dynamic pages, and Partial Prerendering (PPR). The important design
rule is that every route must make its rendering mode intentional.
Accidentally reading request headers, serializing the whole wiki tree,
or putting uncached async work above a PPR boundary can turn a fast
route into a slow or broken one.

## Route Classes

| Route | Mode | Why |
| --- | --- | --- |
| `/` | Static | The homepage is the site index and should be fast on first paint. It uses a build-time site slug (`SITE_SLUG` or Diana) and cached Convex document data. |
| `/about/Index` | Seeded PPR | This is the canonical index route used by page-load tests and initial shell validation. It must render header, sidebar chrome, title, and body text in the server HTML. |
| `/[...slug]` | PPR | Most wiki/source pages get reusable chrome immediately while content can stream through cached document/render entries. |
| `/sources/[...slug]` | PPR | Source pages can be heavy and less frequently viewed, so they keep the shell responsive and defer source body rendering. |
| `/pii-view/[...slug]` | PPR or dynamic reveal path | Revealed PII content may force request-bound behavior. It must not pollute the redacted public cache. |
| `/chat`, `/search`, `/comments`, tools pages | Static or dynamic by feature | These are not document routes. Their cache policy should be owned by their feature specs. |
| API routes | Dynamic unless proven otherwise | Route handlers default to request-bound behavior and should explicitly own HTTP cache headers. |

Preview deployments intentionally seed only the smallest set of pages
needed to validate PPR (`/about/Index`). Production can seed more
high-traffic slugs, but sources are deferred by default so publish and
deploy time do not scale with the full source archive.

## First Paint Contract

Every document page should have useful HTML before client JavaScript:

- app header with Home, search, New Chat, Find Files, and Actions
- desktop sidebar rail or collapsed rail
- mobile bottom page affordance
- document title for the requested page
- body text for the index route and other critical PPR validation pages

The shell tree in `src/app/(main)/layout.tsx` is deliberately shallow:
top-level and second-level nodes only. It does not include full
`sources` or `wiki` branches because the full tree is very large and
serializing it through the RSC stream can dominate HTML size and
trigger client parse/hydration failures. The client refreshes the full
tree from `/api/file-tree?format=compact` after first mount when the
initial tree is empty or contains `truncated` nodes.

Pruned shell data must not masquerade as complete data. If a fallback
tree exposes a `sources` or `wiki` branch with omitted children, that
directory must be marked `truncated` and rendered as not-yet-loaded,
not as an expandable empty branch.

## Data Sources

Runtime document reads come from Convex through `src/lib/markdown.ts`.
The local vault is producer-side only; the publisher CLI reads the
vault and writes redacted documents and assets into Convex/Blob.

Important document helpers:

- `getMarkdownFileForSite(siteSlug, slug)` reads one cached document
  for an explicit site. Use it when a route needs to stay static or
  PPR-safe and already knows the site at build time.
- `getMarkdownFile(slug)` reads the request site from headers. Use it
  only below a boundary where request-bound rendering is acceptable.
- `getCompactFileTreeForSite(siteSlug)` builds the cached sidebar tree
  from documents, PDFs, and file assets as a compact relative trie. The
  compact form stores ordinary descendants by display name and uses
  relative path overrides for aliases such as grouped source
  `Markdown`/`PDF` children, so deep source ancestors are not repeated
  throughout the payload. `getFileTreeForSite(siteSlug)` expands that
  cached compact tree for compatibility callers.
- `getShellFileTreeForSite(siteSlug, { maxDepth: 2 })` expands and
  prunes the cached full tree into the small server shell tree. Deeper
  directories are omitted and their visible parent is marked
  `truncated`.
- `getCanonicalSlug(contentPath)` resolves casing and index aliases
  from the cached canonical slug map.

Do not introduce a request header read above the part of the tree that
must be static or PPR-prerendered. In practice this means avoiding
`headers()`, `cookies()`, and helpers that call them until after the
static/PPR-safe path has resolved its content.

## Markdown Rendering

There are two markdown renderers:

- `MarkdownRenderer` is synchronous and suitable when the page body
  must appear in the initial server HTML, such as `/` and
  `/about/Index`.
- `MarkdownRendererAsync` wraps expensive markdown work in a cached
  async function tagged by site and render version. Use it for normal
  document bodies where streaming is acceptable.

Both renderers delegate the framework-neutral HTML shape to
`@diana-tnbc/wiki-markdown/server`. The package owns markdown plugins,
wikilinks, citations, math cleanup, smart-table markup, PDF chips,
image-theater attributes, theme-paired images, and Mermaid rendering.
`web/src/lib/render-markdown.ts` should remain a Next/server wrapper:
cache key, `.next/cache` filesystem read/write, render-version salt,
and performance logging.

Client-only markdown behavior follows the same split.
`@diana-tnbc/wiki-markdown` owns the React markdown renderer, routed
heading anchors, image theater, and table enhancement islands. The
Next app supplies only `next/link`, `next/navigation`, Sonner
notifications, and the Diana-specific smart-table layout adapter. The
Vite + LiveStore reader supplies React Router navigation and LiveStore
data. The productionization plan for that reader lives in
[`../../plans/vite-livestore-wiki-reader.md`](../../plans/vite-livestore-wiki-reader.md).

The render cache version is `MARKDOWN_RENDER_CACHE_VERSION` in
`src/lib/wiki-cache-tags.ts`. The shared cached markdown renderer passes
that version into its cached function arguments, so bump it when the
rendered HTML shape
changes, for example markdown plugins, table markup, image theater
attributes, citation linking, or sanitization behavior.

## Cache Tags

All wiki caches are site-scoped. The tag hierarchy is:

| Tag helper | Scope |
| --- | --- |
| `siteCacheTag(siteSlug)` | Coarse site-wide invalidation. |
| `siteDocsCacheTag(siteSlug)` | Document list and document-derived data. |
| `siteDocCacheTag(siteSlug, slug)` | One document. |
| `siteAssetsCacheTag(siteSlug)` | Blob-backed PDF/file assets. |
| `siteTreeCacheTag(siteSlug)` | Sidebar tree. |
| `siteTagsCacheTag(siteSlug)` | Tag lists and tag pages. |
| `siteRenderCacheTag(siteSlug)` | Rendered markdown HTML for the current render version. |

Cached Convex readers use `cacheLife("hours")` because publish
invalidates tags explicitly. Rendered markdown uses `cacheLife("weeks")`
because the content hash and render-version tag are the meaningful
invalidators.

Never cache cross-site data without the site tag. Never key an
in-memory or filesystem cache by slug alone unless the data is truly
site-independent.

## Publish Invalidation

Publishing is the freshness boundary. The publisher writes documents
and assets, then invalidates the affected caches through
`src/lib/wiki-revalidation.ts`.

- `revalidatePublishedDocument(siteSlug, slug)` invalidates site,
  docs, tree, tags, render, and the specific document tag.
- `revalidatePublishedAsset(siteSlug)` invalidates site, assets, and
  tree.
- `revalidateSiteAfterPublish(siteSlug)` invalidates all site wiki
  caches and revalidates the root layout path.

This design makes publish fast because deployment does not need to
rebuild the full wiki. It also makes the first request after publish
pay only for the cache entries that are actually visited.

Post-deploy and post-publish maintenance starts
`prewarmWikiPagesWorkflow(siteSlug)`, which fetches actual deployed
routes for `index`, `about/**`, and `wiki/**` in batches. It excludes
`sources/**`, PDFs, assets, and hidden image paths. Outside production,
the workflow skips unless `WIKI_PREWARM_BASE_URL` is set. In production,
it uses `WIKI_PREWARM_BASE_URL` and `WIKI_PREWARM_TOKEN` when set,
otherwise it warms Diana via `https://diana-tnbc.com` with the Diana
magic token.

## PPR Boundaries

PPR works when the static shell and dynamic work are separated cleanly.
The layout owns the outer shell:

- `<Header />` is inside its own Suspense boundary.
- `<NavigationShell initialTree={shellTree}>` gets the shallow cached
  shell tree and then loads the full compact tree on the client when
  the shell is empty or truncated.
- Document content is wrapped inside the navigation shell so the
  layout chrome can paint even when content streams.

Rules for adding work above a PPR boundary:

- Use explicit-site cached helpers instead of request-site helpers.
- Keep serialized props small. A full wiki tree and the full command
  palette page list are not shell props.
- Prefer stable fallback dimensions so hydration and table layout do
  not shift after the dynamic content arrives.
- Do not put client fetches that replace clickable navigation in the
  same tick as first paint; a short initial delay avoids detaching
  links during immediate user/test interaction.

Rules for adding work below a PPR boundary:

- Request-bound helpers are acceptable.
- Slow markdown rendering is acceptable if cached and streamed.
- Source pages may use loading states; wiki pages should avoid showing
  source-specific loading shells.

## Static Index Exception

The root index and `/about/Index` are special. They are used as the
fast-path proof that the site can serve meaningful content with the
least runtime work. They should:

- use `getMarkdownFileForSite(toSiteSlug(process.env.SITE_SLUG ?? DEFAULT_SITE_SLUG), "index")`
- render with `MarkdownRenderer`
- avoid `getRequestSiteSlug()` until after the index content path has
  been resolved
- preserve the display title `Index` for the `/about/Index` alias

This exception is acceptable because the build/deploy environment
knows the site slug for the deployment. Multi-site request routing
still uses `x-site-slug` for normal document pages and APIs.

## Trade-Offs

Static rendering gives the fastest first byte and simplest HTML, but
it requires all inputs to be known without request headers. Use it for
routes whose content is site-global for the deployment.

PPR gives the best reader experience for the wiki: stable chrome
appears immediately and document content can stream. The cost is more
discipline around boundaries and serialized props.

Dynamic rendering is the escape hatch for request-specific content,
PII reveal flows, API routes, and authenticated features. It should be
chosen deliberately because it gives up the PPR/static first-paint
benefits.

Long-lived cache entries keep pages fast and publish inexpensive, but
only if invalidation is complete. Prefer adding a precise tag over
shortening `cacheLife`.

## Regression Tests

The rendering/caching contract is covered by these suites:

- `e2e/page-load-experience.spec.ts` checks server HTML and first paint
  with JavaScript blocked.
- `e2e/navigation.spec.ts` checks sidebar navigation, actions, command
  palette behavior, and canonical redirects.
- `e2e/sidebar-pdfs.spec.ts` checks that the full client tree loads
  after the shallow shell, that `/api/file-tree` returns the full cached
  tree, that `/api/file-tree?format=compact` avoids repeated ancestor
  paths, that page HTML does not serialize deep source paths or command
  palette pages, and that PDFs are represented correctly.
- `e2e/source-loading-boundary.spec.ts` checks that source loading
  shells do not leak into wiki pages.
- `e2e/table-expansion.spec.ts` checks that shell/sidebar changes do
  not break table layout.
- `e2e/image-theater.spec.ts` checks rendered image affordances.

When changing rendering mode, cache tags, the layout shell, markdown
rendering, or publish invalidation, run a preview-style production
build and targeted E2E against `next start`, not only the dev server.

Suggested local command:

```sh
VERCEL=1 VERCEL_ENV=preview bun run build
VERCEL=1 VERCEL_ENV=preview bun run start -- -p 3002
TEST_ENV=prod PROD_URL=http://localhost:3002 PLAYWRIGHT_WORKERS=1 \
  bunx playwright test \
  e2e/navigation.spec.ts \
  e2e/sidebar-pdfs.spec.ts \
  e2e/source-loading-boundary.spec.ts \
  e2e/table-expansion.spec.ts \
  e2e/page-load-experience.spec.ts \
  e2e/image-theater.spec.ts \
  --project=tests --reporter=list
```

## Change Checklist

Before merging rendering or cache changes:

- confirm whether each touched route should be static, PPR, or dynamic
- check that no new `headers()`/`cookies()` read moved above a static
  or PPR boundary
- check that shell props are small and intentionally incomplete
- add or update cache tags for every new cached unit
- verify publish invalidates any new document, asset, tree, tag, or
  render cache
- run lint, typecheck, unit tests, preview build, and the targeted E2E
  suites above

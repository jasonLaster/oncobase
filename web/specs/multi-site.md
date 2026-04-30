# Multi-site Wiki Platform

This is the contract for the shared wiki platform. Diana is site #1;
additional sites share the same Next.js deployment, Convex
deployment, Blob store, and codebase. Isolation is enforced in code.

The plan and the simplification rationale live in
[plans/multi-tenant-wiki](../../plans/multi-tenant-wiki/), with a
phase-by-phase implementation log at
[plans/multi-tenant-wiki/work-log.md](../../plans/multi-tenant-wiki/work-log.md).

## The site model

A site is one row in the `sites` Convex table. The row owns:

- `slug` — URL-safe, `/^[a-z0-9-]{1,32}$/`. Used everywhere outside
  Convex (host resolution, blob keys, cache tags, subjects).
- `domains: string[]` — the hosts this site responds to.
- `publishTokenHash` — `sha256:<hex>` of the publisher's bearer
  token. Plaintext is shown once at site-create time.
- `config` — `title`, `description`, feature flags (`enableChat`,
  `enableComments`, `enableDownloads`), `passwordGate` plus
  optional `passwordHash`, `redirects`, `piiPatterns`,
  `previewSeedSlugs`, `exclusions`.
- `quotas` — `monthlyOpenAITokens`, `blobBytes`.
- `liveblocksWorkspaceId` / `liveblocksSecretKey` /
  `liveblocksPublicKey` (per-site Liveblocks workspaces in v1; the
  prefixed-rooms scheme is a tripwire to revisit at scale).
- `lastPublishedAt`, `lastPublishStatus`, `lastPublishError`,
  `publishLockUntil` — publish state machine.
- `archivedAt` — soft-delete timestamp.

V1 keeps everything in one table. Domain lifecycle, publish-token
rotation, and publish-run history split into separate tables only
when their respective tripwires fire (custom domains arrive,
token leak, "what changed last publish?" asked twice).

## Host resolution

`web/src/proxy.ts` resolves the active site from the `Host` header
once per request and sets `x-site-slug` on the forwarded request.
Subsequent code reads the header — never re-parses the host, never
trusts a client-supplied `x-site-slug`.

Resolution order:

1. `SITE_SLUG` env var (local dev override).
2. `web/.local-hosts.json` fixture
   (`localhost`/`127.0.0.1` → `diana`, plus the per-test sites).
3. `<slug>.localhost` pattern as a final dev fallback.
4. Convex `sites:getByHost` lookup against the `domains` array.
   In-memory cached for 15 seconds.

Unknown hosts return 404 from the proxy. Convex outage on a
non-localhost host returns 503; localhost falls back to Diana so
dev never breaks.

The proxy bypasses the password gate but still attaches
`x-site-slug` for `/api/login`, `/api/auth`, and `/api/publish` —
they own their own auth (token-based for publish, password gate's
own endpoint for login/auth).

## The Convex site invariant

`web/convex/lib/site.ts` exports `requireSite(ctx, siteSlug)`:
returns `{ siteId, siteSlug, site }`. **Every public Convex
function calls it.** ESLint bans direct `ctx.db.query(` outside the
helper module.

During the Diana backfill window, `siteSlug` is optional on every
public function — omitting it resolves to Diana. The helper returns
`siteId: null` for slugs whose `sites` row hasn't been created;
callers use `rowBelongsToSite(row, site)` to decide whether a row
without `siteId` should be visible (only on Diana).

After Phase 7 cutover finishes (Diana fully published into Convex
with `siteId` on every row), the legacy fallback paths get deleted
and the helpers narrow to require `siteId`.

## Scoped tables

Every tenant-owned table carries `siteId: v.optional(v.id("sites"))`
during the migration window plus a leading-`siteId` index:

`documents`, `meta`, `pdfAssets`, `fileAssets`, `conversations`,
`messages`, `users`, `userSessions`, `guestNames`, `commentRooms`.

`documents` search and vector indexes include `siteId` in
`filterFields`. Without this, ranking leaks across sites even when
result lists are filtered. This is invariant 3 of the cross-site
leak suite.

## Blob prefixing

Every blob key is `sites/<siteSlug>/<original-key>`, written via
`web/src/lib/blob.ts`'s `sitePut` helper. ESLint bans direct
`@vercel/blob` imports outside the helper and the publish/ingest
scripts. Sub-prefixes:

- `sites/<slug>/files/...` — generic assets
- `sites/<slug>/pdfs/...` — PDFs
- `sites/<slug>/exports/...` — generated archives (download zips)

## Liveblocks

Each site has its own Liveblocks workspace and credentials in v1.
Cross-site comment leakage is prevented by Liveblocks's own
construction — there is no API that lets a token from workspace A
access a room in workspace B.

Tradeoff: per-site MAU billing instead of aggregate. Tripwire to
move to a shared workspace + room-id-prefix scheme: bill exceeds
~$300/mo or 10+ sites.

(Diana currently shares the deployment-level Liveblocks fallback;
per-site provisioning happens at site-create time once Phase 6's
`wiki:site:create` is wired into Liveblocks's management API.)

## Cache scoping

Every cached unit carries `site:<slug>` plus a more-specific tag
when applicable, e.g. `site:<slug>:doc:<docSlug>`.

In-memory caches are keyed by site slug and bounded. HTTP route
handlers default to `private/no-store` unless they can prove a
site-scoped key and correct `Vary` behavior.

Publish completion calls `revalidateTag(site:<slug>, "default")`
to bust the per-site cache; per-document edits also bust
`site:<slug>:doc:<docSlug>`.

## The publishing API

Publishers run `bun run wiki:publish` against their local Obsidian
vault. The CLI hits `web/src/app/api/publish/[...step]/route.ts`
with a Bearer publish token whose hash matches
`sites.publishTokenHash`.

- `POST /api/publish/begin` — JSON manifest of `{slug, hash}` for
  documents and `{path, hash, kind}` for assets. Returns
  `{runId, missingDocumentSlugs, missingAssetPaths}`. Acquires a
  publish lock unless `dryRun: true`.
- `POST /api/publish/document` — JSON body with one document.
  Server applies `applyPiiRedactions` before write. Convex stores
  only redacted content; raw markdown stays in the publisher's
  vault. Optional `embedding: number[]` from the publisher's own
  `OPENAI_API_KEY`.
- `POST /api/publish/asset` — binary body. siteSlug, asset path,
  kind, hash travel as `x-publish-*` headers. Server uploads via
  `sitePut`, records in `pdfAssets` / `fileAssets`. ~24 MB body
  cap (Vercel Fluid Compute default); larger files surface in
  `.skipped-assets.txt`.
- `POST /api/publish/finish` — releases the lock and bumps
  `lastPublishedAt`.

Embeddings are computed in chunks (≤800K chars per request, ≤100
docs per request) to stay under OpenAI's 300K-tokens-per-request
limit. Phase 4 documented this in the work-log.

## Cross-site leak tests

`web/e2e/multi-site-isolation.spec.ts` exercises three invariants
in CI on every PR. Setup spins up two synthetic sites with
per-run-nonce slugs in dev Convex, publishes one doc to each via
`/api/publish`, and tears them down on completion.

1. **Same-slug isolation cold and warm.** Each host's `/api/search`
   returns only its own data; warm-cache requests don't leak.
2. **Header injection is overwritten.** `x-site-slug: <other>`
   from the client is dropped by the proxy.
3. **Search ranking does not leak.** A shared term ("treatment")
   present in both sites returns only the host site's documents
   when queried per-host. Convex `searchIndex.filterFields["siteId"]`
   is what makes this work.

Failing any invariant is P0. Add new cases here when a new
feature could leak across sites.

## What's deferred

The renderer for tenant-scoped pages still uses
`src/lib/markdown.ts` which reads from disk. That path serves
Diana correctly because Next's `outputFileTracingRoot` ships her
markdown into the function bundle. New sites onboarded through
Phase 4 publish into Convex but their pages render Diana defaults
(title, sidebar) until the rendering layer is swapped. That swap
is Phase 7 cleanup; until then, new sites have correct data plane
and incorrect visual chrome.

`/api/file`, `/api/search`, and the Convex queries that back the
chat tools are all Convex-backed and site-scoped. The
incomplete bit is the static-generation path through
`page-metadata.ts`, `(main)/layout.tsx`, and
`(main)/_components/document-page.tsx`.

The plan's deferral and its tripwire live at
[plans/multi-tenant-wiki/work-log.md](../../plans/multi-tenant-wiki/work-log.md)
under "Phase 2c — re-scoped, deferred to Phase 7".

# Single-site Assumptions Inventory

Snapshot of every place in the engine that assumed one site at the
start of the multi-tenant migration. The remaining public contract now
lives in [multi-site.md](./multi-site.md).

## Filesystem reads from the legacy vault path at runtime — Phase 1

At the start of the migration, the runtime app read a repo-local vault from disk in five places.
After Phase 1 these all flow through Convex/Blob.

| Path | Lines |
|------|-------|
| [src/app/api/file/route.ts](../src/app/api/file/route.ts) | 5–7, 46 |
| [src/app/api/download/route.ts](../src/app/api/download/route.ts) | 13–14, 57, 60, 258 |
| [src/lib/markdown.ts](../src/lib/markdown.ts) | 10, 161, 287, 289, 434 |
| [src/lib/search.ts](../src/lib/search.ts) | 8, 48 |
| [src/workflows/build-download-cache.ts](../src/workflows/build-download-cache.ts) | 40–41, 69 |

`next.config.ts` lines 93–101 (`outputFileTracingExcludes` /
`outputFileTracingIncludes` for the legacy vault path) become dead code
after Phase 1 and get removed there.

## Build-time fs reads — kept (publisher CLI in Phase 4)

Ingest scripts in `scripts/` continue to read `OBSIDIAN_DIR` because
they are the producer side of the publish pipeline. Phase 4 refactors
them into a shared library used by both the CLI and operator tooling,
but keeps the local-vault read.

`scripts/ingest-wiki.ts`, `scripts/ingest-pdfs.ts`,
`scripts/ingest-assets.ts`, `scripts/check-pdfs.ts`,
`scripts/generate-descriptions.ts`, `scripts/build-wiki-zip.ts`.

## Convex public functions — Phase 2

Every public `query` / `mutation` / `action` in `convex/*.ts` currently
takes whatever arguments the caller passes without a site claim. Phase
2 forces all of them through `requireSite(ctx)`.

Files with public surface to scope:

- `convex/documents.ts` — search, getBySlug, listPage*, upsert,
  deleteBySlug, vector/embedding helpers, pdf/file asset helpers.
- `convex/conversations.ts` — list/archived/get, messages, streaming,
  create, beginRun, save/sendMessage, archive/restore.
- `convex/commentRooms.ts` — listActive, increment/decrement/sync.
- `convex/users.ts` — getByEmailForAuth, create, sessions, etc.
- `convex/guestNames.ts` — upsert, getByIds.
- `convex/sites.ts` — added in Phase 2 itself, lives outside the
  per-site scope by design.

`convex/migrations.ts` is operator-only and stays unscoped.

## Liveblocks room IDs — Phase 2 (per-site workspace) keeps as-is

Room IDs in this codebase use the `markdown:<slug>` form already.
Because v1 uses **one Liveblocks workspace per site** with separate
API keys, no room-id prefix scheme is needed — workspace isolation
prevents cross-site access. Files that construct or query room IDs:

- `src/app/api/liveblocks-add-comment/route.ts`
- `src/app/api/liveblocks-threads/route.ts`
- `src/app/api/liveblocks-delete-thread/route.ts`
- `src/app/api/liveblocks-auth/route.ts`
- `src/app/api/liveblocks-webhook/route.ts`

The change in Phase 2 is the workspace credential resolution path:
the auth/webhook routes look up the active site's Liveblocks keys
from `sites.config` instead of using a single deployment-wide secret.

## Hard-coded Diana copy / config — Phase 2 backfill

These engine-level constants must move into the Diana site row and
out of source code so new sites don't inherit them:

| Constant | Location |
|----------|----------|
| Site title / branding | `src/lib/page-metadata.ts` |
| PII redaction patterns | `src/lib/pii-redaction.ts` |
| Preview seed slugs | `scripts/ingest-wiki.ts:29-34` |
| Legacy redirects | `src/proxy.ts` (single-site password gate) |

After Phase 2, engine defaults are empty and the Diana row holds the
specific values.

## Auth / session — Phase 2 + Phase 3

`users` and `userSessions` are global to the Convex deployment. v1
goes site-scoped: same email under different sites is independent.
Decision is now reflected in [multi-site.md](./multi-site.md).

The single-site password gate in [src/proxy.ts](../src/proxy.ts) is
keyed only on a global `authed` cookie. Phase 3 moves this to per-site
cookies (`authed_<siteSlug>`) and reads the password hash from the
resolved site row instead of the engine constant.

## Post-deploy / build pipeline — Phase 4

`scripts/build-vercel.ts` runs Convex deploy, ingest scripts, and
`next build` as part of every Vercel deploy. Phase 4 strips the
ingest invocations: deploys are the engine, publishes are the
content. Build keeps `convex deploy` and `next build`.

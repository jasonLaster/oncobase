# 3. Data Model

Convex is the source of truth. Schema lives in [`web/convex/schema.ts`](../../convex/schema.ts). Every tenant-owned row carries an optional `siteId` (optional only because of the Diana-era backfill window — new writes always set it).

## Table relationships

```mermaid
erDiagram
  sites ||--o{ documents       : owns
  sites ||--o{ pdfAssets       : owns
  sites ||--o{ fileAssets      : owns
  sites ||--o{ conversations   : owns
  sites ||--o{ users           : owns
  sites ||--o{ guestNames      : owns
  sites ||--o{ commentRooms    : owns
  conversations ||--o{ messages : has
  users ||--o{ userSessions    : has

  sites {
    string slug PK
    string name
    string ownerEmail
    string status
    string[] domains
    object config
    object quotas
    string liveblocksWorkspaceId
  }
  documents {
    id siteId FK
    string slug
    string title
    string content
    string[] tags
    string contentHash
    float[] embedding
  }
  conversations {
    id siteId FK
    string title
    string streamingText
    string activeRunId
  }
  messages {
    id conversationId FK
    id siteId FK
    string role
    array parts
  }
```

## The two important indexes

Each tenant table has a **slug-only** index (legacy) and a **site-scoped** composite index. New code must use the site-scoped one.

```mermaid
flowchart LR
  subgraph documents
    bySlug["by_slug (slug)"]
    bySiteSlug["by_site_slug (siteId, slug)"]
    searchContent["searchIndex content\nfilterFields: siteId, slug, tags"]
    vec["vectorIndex embedding\nfilterFields: siteId"]
  end
  Caller[Server code] -->|preferred| bySiteSlug
  Caller -.legacy.-> bySlug
  Caller -->|full-text search| searchContent
  Caller -->|semantic search| vec
```

Why both indexes still exist: during the Diana → multi-tenant cutover some legacy rows had no `siteId`. Reads against `by_slug` would silently return rows from the wrong tenant. The fix was a separate `by_site_slug` index plus a backfill (`scripts/admin/backfill-site-ids.ts`). Search and vector indexes added `siteId` to `filterFields` so ranking can't leak across tenants.

## The `siteId` invariant

```mermaid
flowchart TB
  In[(Incoming request)] --> Slug[siteSlug from x-site-slug]
  Slug --> Resolve["requireSite(ctx, slug) → siteId"]
  Resolve --> Read["query.withIndex('by_site_slug',\nq.eq('siteId', siteId))"]
  Resolve --> Write["mutation.insert / patch\n with siteId set"]
  Read --> Out[(Result)]
  Write --> Audit[updatedAt bumped]
```

- **Reads** must include `siteId` in the index range.
- **Writes** must include `siteId` in the row.
- **Search/vector** must include `siteId` in the filter.

Cross-site leak tests in CI run a fixture with two sites and assert that reads/searches/embeddings against site A never surface site B rows ([`web/specs/multi-site.md`](../../specs/multi-site.md)).

## Storage: where does each kind of asset live?

| Kind | Where | Why |
|---|---|---|
| Markdown body, frontmatter, tags | `documents.content` (Convex) | Fast full-text + vector search. |
| Embedding vector | `documents.embedding` (Convex) | Co-located with content for filterFields. |
| PDF binary | Vercel Blob; URL stored in `pdfAssets.blobUrl` | Convex isn't for blobs; Blob is cheap and CDN-fronted. |
| Other attachments | Vercel Blob via `fileAssets` | Same reason. |
| Prebuilt download zips | Vercel Blob, public | Built by `buildDownloadCacheWorkflow` post-deploy. |
| Liveblocks threads | Liveblocks (external) | Realtime concerns, not ours. We only store `commentRooms` counts for UX. |

Continue to [Publishing pipeline →](04-publishing.md)

import { queryDb, Schema } from "@livestore/livestore";
import { tables } from "./schema";
import { expandCompactFileTree, transformFileTreeForSidebar, type CompactFileNode } from "@oncobase/wiki-content";

export const siteState$ = queryDb({
  query: "select * from siteState where id = 'current'",
  schema: Schema.Array(tables.siteState.rowSchema),
  queriedTables: new Set(["siteState"]),
}, {
  map: (rows) => rows[0] ?? null,
});

export const fileTree$ = queryDb({
  query: "select * from fileTree where id = 'current'",
  schema: Schema.Array(tables.fileTree.rowSchema),
  queriedTables: new Set(["fileTree"]),
}, {
  map: (rows) => rows[0] ?? null,
});

export const pageIndex$ = queryDb(tables.pageIndex.orderBy("slug", "asc"));

// Do not copy cached markdown bodies just to decide what to fetch or evict.
export const cachedPageMetadata$ = queryDb({
  // Older cache entries used UTF-16 length for size. Measure actual body bytes
  // in SQLite without copying the body into JavaScript or flushing warm caches.
  query: "select slug, length(CAST(content AS BLOB)) AS size, fetchedAt, contentHash, contentStatus from pageContent",
  schema: Schema.Array(Schema.Struct({ slug: Schema.String, size: Schema.Number, fetchedAt: Schema.Number, contentHash: Schema.NullOr(Schema.String), contentStatus: Schema.String })),
  queriedTables: new Set(["pageContent"]),
});

// One derived query for desktop/mobile consumers. The manifest materializes its
// tree and index atomically, so a second full-index fallback is unnecessary.
export const sidebarTree$ = queryDb({
  query: "select * from fileTree where id = 'current'",
  schema: Schema.Array(tables.fileTree.rowSchema),
  queriedTables: new Set(["fileTree"]),
}, {
  label: "sidebarTree",
  deps: ["sidebarTree"],
  map: (rows) => {
    const tree = rows[0]?.treeJson;
    if (!tree) return null;
    try {
      return transformFileTreeForSidebar(expandCompactFileTree(JSON.parse(tree) as CompactFileNode[]));
    } catch {
      return [];
    }
  },
});

export const assets$ = queryDb(tables.assetIndex.orderBy("path", "asc"));

export const stalePageContent$ = queryDb({
  query:
    "select * from pageContent where contentStatus in ('stale', 'deleted', 'missing') order by slug asc",
  schema: Schema.Array(tables.pageContent.rowSchema),
  queriedTables: new Set(["pageContent"]),
});

export function pageIndexBySlug$(slug: string) {
  return queryDb(
    {
      query: "select * from pageIndex where slug = ?",
      bindValues: [slug],
      schema: Schema.Array(tables.pageIndex.rowSchema),
      queriedTables: new Set(["pageIndex"]),
    },
    { deps: [slug], label: `pageIndex:${slug}`, map: (rows) => rows[0] ?? null },
  );
}

export function pageContentBySlug$(slug: string) {
  return queryDb(
    {
      query: "select * from pageContent where slug = ?",
      bindValues: [slug],
      schema: Schema.Array(tables.pageContent.rowSchema),
      queriedTables: new Set(["pageContent"]),
    },
    { deps: [slug], label: `pageContent:${slug}`, map: (rows) => rows[0] ?? null },
  );
}

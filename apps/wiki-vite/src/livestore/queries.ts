import { queryDb, Schema } from "@livestore/livestore";
import { tables } from "./schema";

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

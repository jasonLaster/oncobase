import { Events, makeSchema, Schema, State } from "@livestore/livestore";
import { WIKI_READER_SCHEMA_VERSION } from "@oncobase/wiki-content";

export const WIKI_CACHE_SCHEMA_VERSION = WIKI_READER_SCHEMA_VERSION;

export const tables = {
  siteState: State.SQLite.table({
    name: "siteState",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      siteSlug: State.SQLite.text({ default: "", nullable: false }),
      scope: State.SQLite.text({ schema: Schema.Literal("public", "session") }),
      manifestHash: State.SQLite.text({ default: "", nullable: false }),
      generatedAt: State.SQLite.text({ default: "", nullable: false }),
      lastSyncAt: State.SQLite.integer({ default: 0, nullable: false }),
      lastValidatedAt: State.SQLite.integer({ default: 0, nullable: false }),
      manifestSize: State.SQLite.integer({ default: 0, nullable: false }),
      schemaVersion: State.SQLite.integer({
        default: WIKI_CACHE_SCHEMA_VERSION,
        nullable: false,
      }),
    },
  }),
  fileTree: State.SQLite.table({
    name: "fileTree",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      treeJson: State.SQLite.text({ default: "[]", nullable: false }),
      updatedAt: State.SQLite.integer({ default: 0, nullable: false }),
    },
  }),
  pageIndex: State.SQLite.table({
    name: "pageIndex",
    columns: {
      slug: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text({ default: "", nullable: false }),
      tagsJson: State.SQLite.text({ default: "[]", nullable: false }),
      description: State.SQLite.text({ nullable: true }),
      contentHash: State.SQLite.text({ nullable: true }),
      sensitive: State.SQLite.boolean({ default: false, nullable: false }),
      size: State.SQLite.integer({ default: 0, nullable: false }),
    },
    indexes: [{ name: "pageIndex_title", columns: ["title"] }],
  }),
  pageContent: State.SQLite.table({
    name: "pageContent",
    columns: {
      slug: State.SQLite.text({ primaryKey: true }),
      title: State.SQLite.text({ default: "", nullable: false }),
      content: State.SQLite.text({ default: "", nullable: false }),
      tagsJson: State.SQLite.text({ default: "[]", nullable: false }),
      contentHash: State.SQLite.text({ nullable: true }),
      expectedContentHash: State.SQLite.text({ nullable: true }),
      sensitive: State.SQLite.boolean({ default: false, nullable: false }),
      size: State.SQLite.integer({ default: 0, nullable: false }),
      fetchedAt: State.SQLite.integer({ default: 0, nullable: false }),
      missingAt: State.SQLite.integer({ nullable: true }),
      staleAt: State.SQLite.integer({ nullable: true }),
      deletedAt: State.SQLite.integer({ nullable: true }),
      contentStatus: State.SQLite.text({
        default: "fresh",
        nullable: false,
        schema: Schema.Literal("fresh", "stale", "missing", "deleted", "sensitive-unavailable"),
      }),
    },
    indexes: [{ name: "pageContent_status", columns: ["contentStatus"] }],
  }),
  assetIndex: State.SQLite.table({
    name: "assetIndex",
    columns: {
      path: State.SQLite.text({ primaryKey: true }),
      kind: State.SQLite.text({ schema: Schema.Literal("pdf", "file") }),
      contentHash: State.SQLite.text({ nullable: true }),
      size: State.SQLite.integer({ nullable: true }),
    },
  }),
};

const manifestPageSchema = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  description: Schema.NullOr(Schema.String),
  contentHash: Schema.NullOr(Schema.String),
  sensitive: Schema.Boolean,
  size: Schema.Number,
});

const pageContentSchema = Schema.Struct({
  slug: Schema.String,
  title: Schema.String,
  content: Schema.String,
  tags: Schema.Array(Schema.String),
  contentHash: Schema.NullOr(Schema.String),
  sensitive: Schema.Boolean,
  size: Schema.Number,
  fetchedAt: Schema.Number,
});

export const events = {
  manifestApplied: Events.clientOnly({
    name: "v1.ManifestApplied",
    schema: Schema.Struct({
      siteSlug: Schema.String,
      scope: Schema.Literal("public", "session"),
      manifestHash: Schema.String,
      generatedAt: Schema.String,
      receivedAt: Schema.Number,
      manifestSize: Schema.Number,
      compactTreeJson: Schema.String,
      pagesJson: Schema.String,
      assetsJson: Schema.String,
    }),
  }),
  manifestValidated: Events.clientOnly({
    name: "v1.ManifestValidated",
    schema: Schema.Struct({
      manifestHash: Schema.String,
      validatedAt: Schema.Number,
    }),
  }),
  manifestMarkedProvisional: Events.clientOnly({
    name: "v1.ManifestMarkedProvisional",
    schema: Schema.Struct({
      manifestHash: Schema.String,
    }),
  }),
  pageContentFetched: Events.clientOnly({
    name: "v1.PageContentFetched",
    schema: pageContentSchema,
  }),
  pageContentMissing: Events.clientOnly({
    name: "v1.PageContentMissing",
    schema: Schema.Struct({
      slug: Schema.String,
      contentHash: Schema.NullOr(Schema.String),
      missingAt: Schema.Number,
    }),
  }),
  pageContentUnavailable: Events.clientOnly({
    name: "v1.PageContentUnavailable",
    schema: Schema.Struct({
      slug: Schema.String,
      title: Schema.String,
      tags: Schema.Array(Schema.String),
      contentHash: Schema.NullOr(Schema.String),
      sensitive: Schema.Boolean,
      size: Schema.Number,
      unavailableAt: Schema.Number,
    }),
  }),
  cacheResetRequested: Events.clientOnly({
    name: "v1.CacheResetRequested",
    schema: Schema.Struct({ requestedAt: Schema.Number }),
  }),
  pageContentEvicted: Events.clientOnly({
    name: "v1.PageContentEvicted",
    schema: Schema.Struct({ slugs: Schema.Array(Schema.String) }),
  }),
};

function bulkIndexInserts(table: string, sql: string, rows: unknown[]) {
  // Bound SQLite's JSON parsing allocation, including in the fixed-memory
  // in-memory adapter. All batches still belong to one atomic materialization.
  const statements = [];
  for (let start = 0; start < rows.length; start += 256) {
    statements.push({ sql, bindValues: [JSON.stringify(rows.slice(start, start + 256))], writeTables: new Set([table]) });
  }
  return statements;
}

const materializers = State.SQLite.materializers(events, {
  "v1.ManifestApplied": ({
    siteSlug,
    scope,
    manifestHash,
    generatedAt,
    receivedAt,
    manifestSize,
    compactTreeJson,
    pagesJson,
    assetsJson,
  }) => {
    const pages = JSON.parse(pagesJson) as Array<typeof manifestPageSchema.Type>;
    const assets = JSON.parse(assetsJson) as unknown[];
    // Reconcile cached bodies against the manifest in SQL, after pageIndex
    // holds the new pages. The statements depend only on this event, never
    // on rows read here: a materializer that read pageContent produced
    // different statements when a body arrived before a replay, and
    // LiveStore's dev check ("Materializer hash mismatch") shut the store
    // down. Order matters: missing rows are settled before stale/fresh.
    const content = (sql: string, bindValues: unknown[] = []) => ({ sql, bindValues, writeTables: new Set(["pageContent"]) });
    const reconcileContent = [
      // A page the server already answered as unavailable (missing, or
      // sensitive to this reader) is never in this scope's manifest, so its
      // absence is not a deletion. Relabeling it flashed "Page no longer
      // available" before the restricted state with its sign-in action.
      content(`UPDATE pageContent SET expectedContentHash = NULL, contentStatus = 'deleted', staleAt = NULL, deletedAt = ?, missingAt = NULL
        WHERE slug NOT IN (SELECT slug FROM pageIndex)
          AND missingAt IS NULL AND contentStatus NOT IN ('missing', 'sensitive-unavailable')`, [receivedAt]),
      content(`UPDATE pageContent SET title = p.title, tagsJson = p.tagsJson, expectedContentHash = p.contentHash, sensitive = p.sensitive,
          size = p.size, contentStatus = 'missing', staleAt = NULL, deletedAt = NULL
        FROM pageIndex AS p WHERE p.slug = pageContent.slug AND (pageContent.missingAt IS NOT NULL OR pageContent.contentStatus = 'missing')`),
      content(`UPDATE pageContent SET title = p.title, tagsJson = p.tagsJson, expectedContentHash = p.contentHash, sensitive = p.sensitive,
          contentStatus = 'stale', staleAt = ?, deletedAt = NULL, missingAt = NULL
        FROM pageIndex AS p WHERE p.slug = pageContent.slug AND pageContent.missingAt IS NULL AND pageContent.contentStatus != 'missing'
          AND pageContent.contentHash IS NOT p.contentHash`, [receivedAt]),
      content(`UPDATE pageContent SET title = p.title, tagsJson = p.tagsJson, expectedContentHash = p.contentHash, sensitive = p.sensitive,
          contentStatus = 'fresh', staleAt = NULL, deletedAt = NULL, missingAt = NULL
        FROM pageIndex AS p WHERE p.slug = pageContent.slug AND pageContent.missingAt IS NULL AND pageContent.contentStatus != 'missing'
          AND pageContent.contentHash IS p.contentHash`),
    ];

    return [
      tables.siteState.insert({
        id: "current",
        siteSlug,
        scope,
        manifestHash,
        generatedAt,
        lastSyncAt: receivedAt,
        lastValidatedAt: receivedAt,
        manifestSize,
        schemaVersion: WIKI_CACHE_SCHEMA_VERSION,
      }).onConflict("id", "replace"),
      tables.fileTree.insert({
        id: "current",
        treeJson: compactTreeJson,
        updatedAt: receivedAt,
      }).onConflict("id", "replace"),
      tables.pageIndex.delete(),
      tables.assetIndex.delete(),
      // Batched set-based inserts avoid thousands of synchronous
      // query-builder/schema conversions while retaining this atomic event.
      ...bulkIndexInserts("pageIndex", `INSERT OR REPLACE INTO pageIndex (slug, title, tagsJson, description, contentHash, sensitive, size)
          SELECT json_extract(value, '$.slug'), json_extract(value, '$.title'), json_extract(value, '$.tags'),
            json_extract(value, '$.description'), json_extract(value, '$.contentHash'),
            json_extract(value, '$.sensitive'), json_extract(value, '$.size') FROM json_each(?)`, pages),
      ...bulkIndexInserts("assetIndex", `INSERT OR REPLACE INTO assetIndex (path, kind, contentHash, size)
          SELECT json_extract(value, '$.path'), json_extract(value, '$.kind'),
            json_extract(value, '$.contentHash'), json_extract(value, '$.size') FROM json_each(?)`, assets),
      ...reconcileContent,
    ];
  },
  "v1.ManifestValidated": ({ manifestHash, validatedAt }) =>
    tables.siteState.update({
      lastValidatedAt: validatedAt,
    }).where({ id: "current", manifestHash }),
  "v1.ManifestMarkedProvisional": ({ manifestHash }) =>
    tables.siteState.update({
      lastValidatedAt: 0,
    }).where({ id: "current", manifestHash }),
  "v1.PageContentFetched": ({
    slug,
    title,
    content,
    tags,
    contentHash,
    sensitive,
    size,
    fetchedAt,
  }) =>
    tables.pageContent.insert({
      slug,
      title,
      content,
      tagsJson: JSON.stringify(tags),
      contentHash,
      expectedContentHash: contentHash,
      sensitive,
      size,
      fetchedAt,
      missingAt: null,
      staleAt: null,
      deletedAt: null,
      contentStatus: "fresh",
    }).onConflict("slug", "replace"),
  "v1.PageContentMissing": ({ slug, contentHash, missingAt }) =>
    tables.pageContent.insert({
      slug,
      title: slug,
      content: "",
      tagsJson: "[]",
      contentHash,
      expectedContentHash: contentHash,
      sensitive: false,
      size: 0,
      fetchedAt: missingAt,
      missingAt,
      staleAt: null,
      deletedAt: null,
      contentStatus: "missing",
    }).onConflict("slug", "replace"),
  "v1.PageContentUnavailable": ({
    slug,
    title,
    tags,
    contentHash,
    sensitive,
    size,
    unavailableAt,
  }) =>
    tables.pageContent.insert({
      slug,
      title,
      content: "",
      tagsJson: JSON.stringify(tags),
      contentHash,
      expectedContentHash: contentHash,
      sensitive,
      size,
      fetchedAt: unavailableAt,
      missingAt: unavailableAt,
      staleAt: null,
      deletedAt: null,
      contentStatus: "sensitive-unavailable",
    }).onConflict("slug", "replace"),
  "v1.CacheResetRequested": () => [
    tables.siteState.delete(),
    tables.fileTree.delete(),
    tables.pageIndex.delete(),
    tables.pageContent.delete(),
    tables.assetIndex.delete(),
  ],
  "v1.PageContentEvicted": ({ slugs }) => slugs.map(slug => tables.pageContent.delete().where({ slug })),
});

const state = State.SQLite.makeState({ tables, materializers });

export const schema = makeSchema({ events, state });

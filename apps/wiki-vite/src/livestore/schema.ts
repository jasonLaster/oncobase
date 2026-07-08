import { Events, makeSchema, Schema, State } from "@livestore/livestore";

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
      manifestSize: State.SQLite.integer({ default: 0, nullable: false }),
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

const assetSchema = Schema.Struct({
  kind: Schema.Literal("pdf", "file"),
  path: Schema.String,
  contentHash: Schema.NullOr(Schema.String),
  size: Schema.NullOr(Schema.Number),
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
};

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
  }, { query }) => {
    const pages = JSON.parse(pagesJson) as Array<typeof manifestPageSchema.Type>;
    const assets = JSON.parse(assetsJson) as Array<typeof assetSchema.Type>;
    const pagesBySlug = new Map(pages.map((page) => [page.slug, page]));
    const cachedContent = query(tables.pageContent) as Array<
      typeof tables.pageContent.rowSchema.Type
    >;

    const reconcileContent = cachedContent.map((page) => {
      const manifestPage = pagesBySlug.get(page.slug);
      if (!manifestPage) {
        return tables.pageContent.update({
          expectedContentHash: null,
          contentStatus: "deleted",
          staleAt: null,
          deletedAt: receivedAt,
          missingAt: null,
        }).where({ slug: page.slug });
      }

      if (page.missingAt != null || page.contentStatus === "missing") {
        return tables.pageContent.update({
          title: manifestPage.title,
          tagsJson: JSON.stringify(manifestPage.tags),
          expectedContentHash: manifestPage.contentHash,
          sensitive: manifestPage.sensitive,
          size: manifestPage.size,
          contentStatus: "missing",
          staleAt: null,
          deletedAt: null,
        }).where({ slug: page.slug });
      }

      if (page.contentHash !== manifestPage.contentHash) {
        return tables.pageContent.update({
          title: manifestPage.title,
          tagsJson: JSON.stringify(manifestPage.tags),
          expectedContentHash: manifestPage.contentHash,
          sensitive: manifestPage.sensitive,
          size: manifestPage.size,
          contentStatus: "stale",
          staleAt: receivedAt,
          deletedAt: null,
          missingAt: null,
        }).where({ slug: page.slug });
      }

      return tables.pageContent.update({
        title: manifestPage.title,
        tagsJson: JSON.stringify(manifestPage.tags),
        expectedContentHash: manifestPage.contentHash,
        sensitive: manifestPage.sensitive,
        size: manifestPage.size,
        contentStatus: "fresh",
        staleAt: null,
        deletedAt: null,
        missingAt: null,
      }).where({ slug: page.slug });
    });

    return [
      tables.siteState.insert({
        id: "current",
        siteSlug,
        scope,
        manifestHash,
        generatedAt,
        lastSyncAt: receivedAt,
        manifestSize,
      }).onConflict("id", "replace"),
      tables.fileTree.insert({
        id: "current",
        treeJson: compactTreeJson,
        updatedAt: receivedAt,
      }).onConflict("id", "replace"),
      tables.pageIndex.delete(),
      tables.assetIndex.delete(),
      ...pages.map((page) =>
        tables.pageIndex.insert({
          slug: page.slug,
          title: page.title,
          tagsJson: JSON.stringify(page.tags),
          description: page.description,
          contentHash: page.contentHash,
          sensitive: page.sensitive,
          size: page.size,
        }).onConflict("slug", "replace"),
      ),
      ...assets.map((asset) =>
        tables.assetIndex.insert({
          path: asset.path,
          kind: asset.kind,
          contentHash: asset.contentHash,
          size: asset.size,
        }).onConflict("path", "replace"),
      ),
      ...reconcileContent,
    ];
  },
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
});

const state = State.SQLite.makeState({ tables, materializers });

export const schema = makeSchema({ events, state });

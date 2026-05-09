import { v } from "convex/values";
import { api } from "./_generated/api";
import {
  action,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

// Multi-tenant scoping: every public function takes an optional
// `siteSlug` argument. During the Diana migration window, omitting it
// resolves to the Diana site (DEFAULT_SITE_SLUG). After Phase 3 wires
// the host-derived header into every callsite, the slug becomes
// effectively required.

type AnyCtx = QueryCtx | MutationCtx;

function isPublicDocument(doc: { sensitive?: boolean }) {
  return doc.sensitive !== true;
}

function canReadDocument(
  doc: { sensitive?: boolean; deletedAt?: number },
  includeSensitive?: boolean,
) {
  return !doc.deletedAt && (includeSensitive || isPublicDocument(doc));
}

function assetPathToSiblingSlug(assetPath: string) {
  return assetPath.replace(/\.[^/.]+$/, "");
}

async function findDocBySlug(ctx: AnyCtx, site: SiteCtx, slug: string) {
  const siteId = site.siteId;
  if (siteId) {
    const scoped = await ctx.db
      .query("documents")
      .withIndex("by_site_slug", (q) => q.eq("siteId", siteId).eq("slug", slug))
      .first();
    if (scoped) return scoped;
  }
  // Legacy rows without siteId — accepted only on the default site.
  const legacy = await ctx.db
    .query("documents")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

async function findAssetByPath(
  ctx: AnyCtx,
  table: "pdfAssets" | "fileAssets",
  site: SiteCtx,
  pathArg: string,
) {
  const siteId = site.siteId;
  if (siteId) {
    const scoped = await ctx.db
      .query(table)
      .withIndex("by_site_path", (q) => q.eq("siteId", siteId).eq("path", pathArg))
      .first();
    if (scoped) return scoped;
  }
  const legacy = await ctx.db
    .query(table)
    .withIndex("by_path", (q) => q.eq("path", pathArg))
    .first();
  if (legacy && rowBelongsToSite(legacy, site)) return legacy;
  return null;
}

async function isSensitiveAssetPath(ctx: AnyCtx, site: SiteCtx, assetPath: string) {
  const doc = await findDocBySlug(ctx, site, assetPathToSiblingSlug(assetPath));
  return doc?.sensitive === true;
}

async function canReadAssetPath(
  ctx: AnyCtx,
  site: SiteCtx,
  assetPath: string,
  includeSensitive?: boolean,
) {
  return includeSensitive || !(await isSensitiveAssetPath(ctx, site, assetPath));
}

async function sensitiveSiblingSlugSet(ctx: QueryCtx, site: SiteCtx) {
  if (!site.siteId) return new Set<string>();
  const sensitiveDocs = await ctx.db
    .query("documents")
    .withIndex("by_site_sensitive_slug", (q) =>
      q.eq("siteId", site.siteId!).eq("sensitive", true),
    )
    .collect();
  return new Set(
    sensitiveDocs
      .filter((doc) => rowBelongsToSite(doc, site) && !doc.deletedAt)
      .map((doc) => doc.slug),
  );
}

function canReadAssetWithSensitiveSlugs(
  assetPath: string,
  sensitiveSlugs: Set<string> | null,
) {
  return !sensitiveSlugs?.has(assetPathToSiblingSlug(assetPath));
}

export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { query: q, limit, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const take = limit ?? 10;

    // searchIndex filterFields include siteId — this prevents ranking
    // leak across sites. For legacy rows without siteId, we widen by
    // filtering after with rowBelongsToSite. Diana sees both; other
    // sites only see their own siteId rows.
    const [contentResults, titleResults] = await Promise.all([
      ctx.db
        .query("documents")
        .withSearchIndex("search_content", (s) =>
          site.siteId ? s.search("content", q).eq("siteId", site.siteId) : s.search("content", q),
        )
        .take(take * 2),
      ctx.db
        .query("documents")
        .withSearchIndex("search_title", (s) =>
          site.siteId ? s.search("title", q).eq("siteId", site.siteId) : s.search("title", q),
        )
        .take(take * 2),
    ]);

    const seen = new Set<string>();
    const merged = [];
    for (const doc of [...titleResults, ...contentResults]) {
      if (seen.has(doc._id)) continue;
      if (!rowBelongsToSite(doc, site)) continue;
      if (!canReadDocument(doc, includeSensitive)) continue;
      seen.add(doc._id);
      merged.push(doc);
    }

    return merged.slice(0, take).map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      tags: doc.tags,
      excerpt: extractExcerpt(doc.content, q),
    }));
  },
});

export const getBySlug = query({
  args: {
    slug: v.string(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { slug, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc || !canReadDocument(doc, includeSensitive)) return null;
    return {
      slug: doc.slug,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
      description: doc.description,
      contentHash: doc.contentHash,
      hashFunctionVersion: doc.hashFunctionVersion,
      sensitive: doc.sensitive,
    };
  },
});

async function paginatedDocs(ctx: AnyCtx, site: SiteCtx, cursor: string | null, numItems: number) {
  const siteId = site.siteId;
  if (siteId) {
    return await ctx.db
      .query("documents")
      .withIndex("by_site_slug", (q) => q.eq("siteId", siteId))
      .paginate({ cursor, numItems });
  }
  return await ctx.db.query("documents").paginate({ cursor, numItems });
}

export const listPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, title, tags, sensitive }) => ({
          slug,
          title,
          tags,
          sensitive,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listPageWithDescriptions = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, title, description, content, sensitive }) => ({
          slug,
          title,
          description: description ?? null,
          content,
          sensitive,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listPageWithContent = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, title, content, tags, contentHash, sensitive }) => ({
          slug,
          title,
          content,
          tags,
          contentHash,
          sensitive,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listManifestPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, title, tags, description, content, contentHash, sensitive }) => ({
          slug,
          title,
          tags,
          description: description ?? null,
          contentHash: contentHash ?? null,
          sensitive: sensitive === true,
          size: content.length,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const list = action({
  args: {
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { includeSensitive, siteSlug },
  ): Promise<Array<{ slug: string; title: string; tags: string[]; sensitive?: boolean }>> => {
    const results: Array<{ slug: string; title: string; tags: string[]; sensitive?: boolean }> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page: {
        page: Array<{
          slug: string;
          title: string;
          tags: string[];
          sensitive?: boolean;
        }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(api.documents.listPage, {
        cursor,
        numItems: 1000,
        includeSensitive,
        siteSlug,
      });
      results.push(...page.page);
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return results;
  },
});

export const getByTag = action({
  args: {
    tag: v.string(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { tag, includeSensitive, siteSlug },
  ): Promise<Array<{ slug: string; title: string; sensitive?: boolean }>> => {
    const allDocs = await ctx.runAction(api.documents.list, {
      includeSensitive,
      siteSlug,
    });
    return allDocs
      .filter((d) => d.tags.includes(tag))
      .map(({ slug, title, sensitive }) => ({ slug, title, sensitive }))
      .sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const listTags = action({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }): Promise<string[]> => {
    const docs = await ctx.runAction(api.documents.list, { siteSlug });
    const tags = new Set<string>();
    for (const doc of docs) {
      for (const tag of doc.tags) tags.add(tag);
    }
    return Array.from(tags).sort();
  },
});

export const upsert = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    contentHash: v.string(),
    hashFunctionVersion: v.optional(v.number()),
    sensitive: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { siteSlug, slug, title, content, tags, contentHash, hashFunctionVersion, sensitive = false },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await findDocBySlug(ctx, site, slug);
    if (existing) {
      if (
        existing.contentHash === contentHash &&
        existing.hashFunctionVersion === hashFunctionVersion &&
        existing.sensitive === sensitive &&
        !existing.deletedAt
      ) {
        return { skipped: true };
      }
      await ctx.db.patch(existing._id, {
        title,
        content,
        tags,
        contentHash,
        hashFunctionVersion,
        sensitive,
        siteId: site.siteId ?? existing.siteId,
        deletedAt: undefined,
        updatedAt: Date.now(),
      });
      return { skipped: false };
    }
    await ctx.db.insert("documents", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      slug,
      title,
      content,
      tags,
      contentHash,
      hashFunctionVersion,
      sensitive,
      updatedAt: Date.now(),
    });
    return { skipped: false };
  },
});

// Admin-only: overwrite a doc's contentHash without touching any
// other fields. Used by scripts/admin/backfill-content-hashes.ts to
// migrate from the legacy ingest hash function to the publisher's.
export const setContentHash = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    slug: v.string(),
    contentHash: v.string(),
  },
  handler: async (ctx, { siteSlug, slug, contentHash }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { found: false, patched: false };
    if (doc.contentHash === contentHash) return { found: true, patched: false };
    await ctx.db.patch(doc._id, { contentHash });
    return { found: true, patched: true };
  },
});

// Bulk variant of setContentHash. Backfilling 4000+ rows
// one-mutation-per-call took ~90s; one mutation per batch of 200
// finishes in seconds. Convex enforces a 16MB function-arg cap, so
// callers must batch.
export const bulkSetContentHash = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    hashFunctionVersion: v.optional(v.number()),
    entries: v.array(
      v.object({ slug: v.string(), contentHash: v.string() }),
    ),
  },
  handler: async (ctx, { siteSlug, hashFunctionVersion, entries }) => {
    const site = await requireSite(ctx, siteSlug);
    let patched = 0;
    let alreadyMatching = 0;
    let missing = 0;
    for (const { slug, contentHash } of entries) {
      const doc = await findDocBySlug(ctx, site, slug);
      if (!doc) {
        missing++;
        continue;
      }
      if (
        doc.contentHash === contentHash &&
        doc.hashFunctionVersion === hashFunctionVersion
      ) {
        alreadyMatching++;
        continue;
      }
      await ctx.db.patch(doc._id, { contentHash, hashFunctionVersion });
      patched++;
    }
    return { patched, alreadyMatching, missing };
  },
});

export const listPageDescriptions = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, description }) => ({ slug, description: description ?? null })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getDescription = query({
  args: {
    slug: v.string(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { slug, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    return doc && canReadDocument(doc, includeSensitive) ? doc.description ?? null : null;
  },
});

export const setDescription = mutation({
  args: { slug: v.string(), description: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { slug, description, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { found: false };
    await ctx.db.patch(doc._id, { description });
    return { found: true };
  },
});

export const deleteBySlug = mutation({
  args: { slug: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { slug, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { deleted: false };
    // Tombstone rather than hard-delete — gives a 90-day undo window.
    // Phase 4's publish/finish writes deletedAt; Phase 6 destroy
    // hard-deletes rows past the retention window.
    await ctx.db.patch(doc._id, { deletedAt: Date.now() });
    return { deleted: true };
  },
});

export const getById = query({
  args: {
    id: v.id("documents"),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { id, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await ctx.db.get(id);
    if (!doc || !rowBelongsToSite(doc, site) || !canReadDocument(doc, includeSensitive)) return null;
    return { slug: doc.slug, title: doc.title, tags: doc.tags };
  },
});

export const vectorSearch = action({
  args: {
    embedding: v.array(v.float64()),
    limit: v.optional(v.number()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { embedding, limit, siteSlug },
  ): Promise<
    Array<{ slug: string; title: string; tags: string[]; score: number }>
  > => {
    const take = limit ?? 10;
    // Resolve site so we can pass siteId into the vector filter and
    // reject results that don't belong (covers legacy rows for Diana).
    const site = await ctx.runQuery(api.sites.getBySlug, {
      slug: siteSlug ?? "diana",
    });

    const siteId = site?._id;
    const results = await ctx.vectorSearch("documents", "by_embedding", {
      vector: embedding,
      limit: take,
      ...(siteId ? { filter: (q) => q.eq("siteId", siteId) } : {}),
    });

    const docs = await Promise.all(
      results.map(async (r) => {
        const doc = await ctx.runQuery(api.documents.getById, {
          id: r._id,
          siteSlug,
        });
        if (!doc) return null;
        return {
          slug: doc.slug,
          title: doc.title,
          tags: doc.tags,
          score: r._score,
        };
      }),
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});

export const embeddingStatus = action({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (
    ctx,
    { siteSlug },
  ): Promise<
    Array<{
      slug: string;
      contentHash: string | undefined;
      embeddingHash: string | undefined;
      sensitive: boolean | undefined;
    }>
  > => {
    const results: Array<{
      slug: string;
      contentHash: string | undefined;
      embeddingHash: string | undefined;
      sensitive: boolean | undefined;
    }> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page: {
        page: Array<{
          slug: string;
          contentHash: string | undefined;
          embeddingHash: string | undefined;
          sensitive: boolean | undefined;
        }>;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(api.documents.embeddingStatusPage, {
        cursor,
        numItems: 50,
        includeSensitive: true,
        siteSlug,
      });
      results.push(...page.page);
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return results;
  },
});

export const embeddingStatusPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map((doc) => ({
          slug: doc.slug,
          contentHash: doc.contentHash,
          hashFunctionVersion: doc.hashFunctionVersion,
          embeddingHash: doc.embeddingHash,
          sensitive: doc.sensitive,
        })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const upsertEmbedding = mutation({
  args: {
    slug: v.string(),
    embedding: v.array(v.float64()),
    embeddingHash: v.optional(v.string()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { slug, embedding, embeddingHash, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { found: false };
    await ctx.db.patch(doc._id, { embedding, embeddingHash });
    return { found: true };
  },
});

export const getMeta = query({
  args: { key: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { key, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    if (siteId) {
      const scoped = await ctx.db
        .query("meta")
        .withIndex("by_site_key", (q) => q.eq("siteId", siteId).eq("key", key))
        .first();
      if (scoped) return scoped.value;
    }
    const legacy = await ctx.db
      .query("meta")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (legacy && rowBelongsToSite(legacy, site)) return legacy.value;
    return null;
  },
});

export const setMeta = mutation({
  args: { key: v.string(), value: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { key, value, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    const existing = siteId
      ? await ctx.db
          .query("meta")
          .withIndex("by_site_key", (q) => q.eq("siteId", siteId).eq("key", key))
          .first()
      : await ctx.db
          .query("meta")
          .withIndex("by_key", (q) => q.eq("key", key))
          .first();
    if (existing && rowBelongsToSite(existing, site)) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("meta", {
        ...(site.siteId ? { siteId: site.siteId } : {}),
        key,
        value,
      });
    }
  },
});

export const listPdfAssets = query({
  args: {
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const sensitiveSlugs = includeSensitive
      ? null
      : await sensitiveSiblingSlugSet(ctx, site);
    const rows = site.siteId
      ? await ctx.db
          .query("pdfAssets")
          .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
          .collect()
      : await ctx.db.query("pdfAssets").collect();
    const out = [];
    for (const row of rows) {
      if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
      if (!canReadAssetWithSensitiveSlugs(row.path, sensitiveSlugs)) continue;
      out.push(row);
    }
    return out;
  },
});

// Paginated path-only listing — keeps under Convex's 8192-entry cap
// and is what the renderer needs to build the sidebar tree.
export const listPdfAssetPathsPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const sensitiveSlugs = includeSensitive
      ? null
      : await sensitiveSiblingSlugSet(ctx, site);
    const result = site.siteId
      ? await ctx.db
          .query("pdfAssets")
          .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
          .paginate({ cursor, numItems })
      : await ctx.db.query("pdfAssets").paginate({ cursor, numItems });
    const page = [];
    for (const row of result.page) {
      if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
      if (!canReadAssetWithSensitiveSlugs(row.path, sensitiveSlugs)) continue;
      page.push(row.path);
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getPdfAssetByPath = query({
  args: {
    path: v.string(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { path, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const row = await findAssetByPath(ctx, "pdfAssets", site, path);
    if (
      !row ||
      row.deletedAt ||
      !(await canReadAssetPath(ctx, site, row.path, includeSensitive))
    ) {
      return null;
    }
    return row;
  },
});

export const upsertPdfAsset = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, { siteSlug, path, blobUrl, sizeBytes, contentHash }) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await findAssetByPath(ctx, "pdfAssets", site, path);
    if (existing) {
      await ctx.db.patch(existing._id, {
        blobUrl,
        sizeBytes,
        contentHash,
        siteId: site.siteId ?? existing.siteId,
        deletedAt: undefined,
        uploadedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("pdfAssets", {
        ...(site.siteId ? { siteId: site.siteId } : {}),
        path,
        blobUrl,
        sizeBytes,
        contentHash,
        uploadedAt: Date.now(),
      });
    }
  },
});

export const deletePdfAssetByPath = mutation({
  args: { path: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { path, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const row = await findAssetByPath(ctx, "pdfAssets", site, path);
    if (!row) return { deleted: false };
    await ctx.db.patch(row._id, { deletedAt: Date.now() });
    return { deleted: true };
  },
});

export const listFileAssets = query({
  args: {
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const sensitiveSlugs = includeSensitive
      ? null
      : await sensitiveSiblingSlugSet(ctx, site);
    const rows = site.siteId
      ? await ctx.db
          .query("fileAssets")
          .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
          .collect()
      : await ctx.db.query("fileAssets").collect();
    const out = [];
    for (const row of rows) {
      if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
      if (!canReadAssetWithSensitiveSlugs(row.path, sensitiveSlugs)) continue;
      out.push(row);
    }
    return out;
  },
});

// Paginated `{kind, path, contentHash}` listing across both
// `pdfAssets` and `fileAssets`, used by the publisher to diff the
// site's current asset state against the local manifest. Tablesare
// scanned in lockstep so a single cursor traverses both.
export const assetHashesPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    // This query is used by publisher/admin diffing, not public
    // navigation. Return the full hash inventory without per-asset
    // sibling document checks, which can exceed Convex's read limit on
    // large vaults.
    const includeAll = includeSensitive ?? true;
    const sensitiveSlugs = includeAll
      ? null
      : await sensitiveSiblingSlugSet(ctx, site);
    const parsed = cursor ? (JSON.parse(cursor) as {
      pdf: string | null;
      pdfDone: boolean;
      file: string | null;
      fileDone: boolean;
    }) : { pdf: null, pdfDone: false, file: null, fileDone: false };

    const out: Array<{
      kind: "pdf" | "file";
      path: string;
      contentHash: string | undefined;
      sizeBytes?: number;
      blobUrl: string;
    }> = [];

    let pdfState = { cursor: parsed.pdf, done: parsed.pdfDone };
    let fileState = { cursor: parsed.file, done: parsed.fileDone };
    if (!pdfState.done) {
      const result = site.siteId
        ? await ctx.db
            .query("pdfAssets")
            .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
            .paginate({ cursor: pdfState.cursor, numItems })
        : await ctx.db.query("pdfAssets").paginate({
            cursor: pdfState.cursor,
            numItems,
          });
      for (const row of result.page) {
        if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
        if (!canReadAssetWithSensitiveSlugs(row.path, sensitiveSlugs)) continue;
        out.push({
          kind: "pdf",
          path: row.path,
          contentHash: row.contentHash,
          sizeBytes: row.sizeBytes,
          blobUrl: row.blobUrl,
        });
      }
      pdfState = { cursor: result.continueCursor, done: result.isDone };
    } else if (!fileState.done) {
      const result = site.siteId
        ? await ctx.db
            .query("fileAssets")
            .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
            .paginate({ cursor: fileState.cursor, numItems })
        : await ctx.db.query("fileAssets").paginate({
            cursor: fileState.cursor,
            numItems,
          });
      for (const row of result.page) {
        if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
        if (!canReadAssetWithSensitiveSlugs(row.path, sensitiveSlugs)) continue;
        out.push({
          kind: "file",
          path: row.path,
          contentHash: row.contentHash,
          sizeBytes: row.sizeBytes,
          blobUrl: row.blobUrl,
        });
      }
      fileState = { cursor: result.continueCursor, done: result.isDone };
    }

    const isDone = pdfState.done && fileState.done;
    return {
      page: out,
      isDone,
      continueCursor: JSON.stringify({
        pdf: pdfState.cursor,
        pdfDone: pdfState.done,
        file: fileState.cursor,
        fileDone: fileState.done,
      }),
    };
  },
});

// Paginated path-only listing — keeps under Convex's 8192-entry cap
// for sites with thousands of file assets.
export const listFileAssetPathsPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const sensitiveSlugs = includeSensitive
      ? null
      : await sensitiveSiblingSlugSet(ctx, site);
    const result = site.siteId
      ? await ctx.db
          .query("fileAssets")
          .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
          .paginate({ cursor, numItems })
      : await ctx.db.query("fileAssets").paginate({ cursor, numItems });
    const page = [];
    for (const row of result.page) {
      if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
      if (!canReadAssetWithSensitiveSlugs(row.path, sensitiveSlugs)) continue;
      page.push(row.path);
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const getFileAssetByPath = query({
  args: {
    path: v.string(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { path, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const row = await findAssetByPath(ctx, "fileAssets", site, path);
    if (
      !row ||
      row.deletedAt ||
      !(await canReadAssetPath(ctx, site, row.path, includeSensitive))
    ) {
      return null;
    }
    return row;
  },
});

export const upsertFileAsset = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
  },
  handler: async (ctx, { siteSlug, path, blobUrl, sizeBytes, contentHash }) => {
    const site = await requireSite(ctx, siteSlug);
    const existing = await findAssetByPath(ctx, "fileAssets", site, path);
    if (existing) {
      await ctx.db.patch(existing._id, {
        blobUrl,
        sizeBytes,
        contentHash,
        siteId: site.siteId ?? existing.siteId,
        deletedAt: undefined,
        uploadedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("fileAssets", {
        ...(site.siteId ? { siteId: site.siteId } : {}),
        path,
        blobUrl,
        sizeBytes,
        contentHash,
        uploadedAt: Date.now(),
      });
    }
  },
});

export const deleteFileAssetByPath = mutation({
  args: { path: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { path, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const row = await findAssetByPath(ctx, "fileAssets", site, path);
    if (!row) return { deleted: false };
    await ctx.db.patch(row._id, { deletedAt: Date.now() });
    return { deleted: true };
  },
});

function extractExcerpt(content: string, query: string): string {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 200);
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + query.length + 120);
  return (
    (start > 0 ? "..." : "") +
    content.slice(start, end) +
    (end < content.length ? "..." : "")
  );
}

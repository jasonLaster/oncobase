import { query, mutation, action, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { query: q, limit }) => {
    const take = limit ?? 10;

    // Search both content and title indexes, then merge
    const [contentResults, titleResults] = await Promise.all([
      ctx.db
        .query("documents")
        .withSearchIndex("search_content", (s) => s.search("content", q))
        .take(take),
      ctx.db
        .query("documents")
        .withSearchIndex("search_title", (s) => s.search("title", q))
        .take(take),
    ]);

    // Deduplicate, preferring content matches
    const seen = new Set<string>();
    const merged = [];
    for (const doc of [...titleResults, ...contentResults]) {
      if (seen.has(doc._id)) continue;
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
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!doc) return null;
    return {
      slug: doc.slug,
      title: doc.title,
      content: doc.content,
      tags: doc.tags,
    };
  },
});

/** Paginated internal query — fetches one page at a time */
export const listPage = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }): Promise<{
    page: Array<{ slug: string; title: string; tags: string[] }>;
    isDone: boolean;
    continueCursor: string;
  }> => {
    const result = await ctx.db.query("documents").paginate({ cursor, numItems });
    return {
      page: result.page.map(({ slug, title, tags }) => ({ slug, title, tags })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Paginated query that includes content — used by the archive builder to avoid N+1 getBySlug calls */
export const listPageWithContent = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }): Promise<{
    page: Array<{ slug: string; content: string }>;
    isDone: boolean;
    continueCursor: string;
  }> => {
    const result = await ctx.db.query("documents").paginate({ cursor, numItems });
    return {
      page: result.page.map(({ slug, content }) => ({ slug, content })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Collects all documents via paginated action to avoid query size limits */
export const list = action({
  handler: async (ctx): Promise<Array<{ slug: string; title: string; tags: string[] }>> => {
    const results: Array<{ slug: string; title: string; tags: string[] }> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page: { page: Array<{ slug: string; title: string; tags: string[] }>; isDone: boolean; continueCursor: string } = await ctx.runQuery(api.documents.listPage, { cursor, numItems: 50 });
      results.push(...page.page);
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return results;
  },
});

export const getByTag = action({
  args: { tag: v.string() },
  handler: async (ctx, { tag }): Promise<Array<{ slug: string; title: string }>> => {
    const allDocs = await ctx.runAction(api.documents.list, {});
    return allDocs
      .filter((d) => d.tags.includes(tag))
      .map(({ slug, title }) => ({ slug, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const listTags = action({
  handler: async (ctx): Promise<string[]> => {
    const docs = await ctx.runAction(api.documents.list, {});
    const tags = new Set<string>();
    for (const doc of docs) {
      for (const tag of doc.tags) tags.add(tag);
    }
    return Array.from(tags).sort();
  },
});

export const upsert = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    tags: v.array(v.string()),
    contentHash: v.string(),
  },
  handler: async (ctx, { slug, title, content, tags, contentHash }) => {
    const existing = await ctx.db
      .query("documents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (existing) {
      if (existing.contentHash === contentHash) return { skipped: true };
      await ctx.db.patch(existing._id, { title, content, tags, contentHash, updatedAt: Date.now() });
      return { skipped: false };
    } else {
      await ctx.db.insert("documents", { slug, title, content, tags, contentHash, updatedAt: Date.now() });
      return { skipped: false };
    }
  },
});

export const deleteBySlug = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (doc) {
      await ctx.db.delete(doc._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});

export const getById = query({
  args: { id: v.id("documents") },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) return null;
    return { slug: doc.slug, title: doc.title, tags: doc.tags };
  },
});

export const vectorSearch = action({
  args: { embedding: v.array(v.float64()), limit: v.optional(v.number()) },
  handler: async (ctx, { embedding, limit }): Promise<Array<{ slug: string; title: string; tags: string[]; score: number }>> => {
    const take = limit ?? 10;
    const results = await ctx.vectorSearch("documents", "by_embedding", {
      vector: embedding,
      limit: take,
    });

    const docs: Array<{ slug: string; title: string; tags: string[]; score: number } | null> = await Promise.all(
      results.map(async (r) => {
        const doc = await ctx.runQuery(api.documents.getById, { id: r._id });
        if (!doc) return null;
        return { slug: doc.slug, title: doc.title, tags: doc.tags, score: r._score };
      })
    );

    return docs.filter((d): d is NonNullable<typeof d> => d !== null);
  },
});

/** Return embedding status for all docs so the ingest script can skip unchanged ones */
export const embeddingStatus = action({
  handler: async (ctx): Promise<Array<{ slug: string; contentHash: string | undefined; embeddingHash: string | undefined }>> => {
    const results: Array<{ slug: string; contentHash: string | undefined; embeddingHash: string | undefined }> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page: { page: Array<{ slug: string; contentHash: string | undefined; embeddingHash: string | undefined }>; isDone: boolean; continueCursor: string } = await ctx.runQuery(api.documents.embeddingStatusPage, { cursor, numItems: 50 });
      results.push(...page.page);
      isDone = page.isDone;
      cursor = page.continueCursor;
    }
    return results;
  },
});

export const embeddingStatusPage = query({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const result = await ctx.db.query("documents").paginate({ cursor, numItems });
    return {
      page: result.page.map((doc) => ({
        slug: doc.slug,
        contentHash: doc.contentHash,
        embeddingHash: doc.embeddingHash,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const upsertEmbedding = mutation({
  args: { slug: v.string(), embedding: v.array(v.float64()), embeddingHash: v.optional(v.string()) },
  handler: async (ctx, { slug, embedding, embeddingHash }) => {
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!doc) return { found: false };
    await ctx.db.patch(doc._id, { embedding, embeddingHash });
    return { found: true };
  },
});

export const getMeta = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("meta")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row ? row.value : null;
  },
});

export const setMeta = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("meta")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value });
    } else {
      await ctx.db.insert("meta", { key, value });
    }
  },
});

export const listPdfAssets = query({
  handler: async (ctx) => {
    return await ctx.db.query("pdfAssets").collect();
  },
});

export const upsertPdfAsset = mutation({
  args: {
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, { path, blobUrl, sizeBytes }) => {
    const existing = await ctx.db
      .query("pdfAssets")
      .withIndex("by_path", (q) => q.eq("path", path))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { blobUrl, sizeBytes, uploadedAt: Date.now() });
    } else {
      await ctx.db.insert("pdfAssets", { path, blobUrl, sizeBytes, uploadedAt: Date.now() });
    }
  },
});

function extractExcerpt(content: string, query: string): string {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 200);
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + query.length + 120);
  return (start > 0 ? "..." : "") + content.slice(start, end) + (end < content.length ? "..." : "");
}

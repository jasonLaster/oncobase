import { query, mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";

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

export const list = query({
  handler: async (ctx) => {
    const docs = await ctx.db.query("documents").collect();
    return docs.map((doc) => ({
      slug: doc.slug,
      title: doc.title,
      tags: doc.tags,
    }));
  },
});

export const getByTag = query({
  args: { tag: v.string() },
  handler: async (ctx, { tag }) => {
    const allDocs = await ctx.db.query("documents").collect();
    const matching = allDocs.filter((d) => d.tags.includes(tag));
    return matching
      .map((doc) => ({ slug: doc.slug, title: doc.title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  },
});

export const listTags = query({
  handler: async (ctx) => {
    const docs = await ctx.db.query("documents").collect();
    const tags = new Set<string>();
    for (const doc of docs) {
      for (const tag of doc.tags) {
        tags.add(tag);
      }
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

export const removeStale = mutation({
  args: { activeSlugs: v.array(v.string()) },
  handler: async (ctx, { activeSlugs }) => {
    const activeSet = new Set(activeSlugs);
    const allDocs = await ctx.db.query("documents").collect();
    let removed = 0;
    for (const doc of allDocs) {
      if (!activeSet.has(doc.slug)) {
        await ctx.db.delete(doc._id);
        removed++;
      }
    }
    return { removed };
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

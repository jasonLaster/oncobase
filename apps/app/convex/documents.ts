import { internalQueryFor } from "./lib/serviceFunctions";
import { v } from "convex/values";
import { api } from "./_generated/api";
import {
  action,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./lib/serviceFunctions";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";
import { invalidateManifest } from "./lib/manifestRevision";
import { assertPublishRun } from "./lib/publishRun";
import { hasCompleteAssetVisibility } from "./lib/assetVisibility";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { applyPiiRedactions, parseSitePiiPatterns } from "@oncobase/wiki-content/pii";

// Multi-tenant scoping: every public function takes an optional
// `siteSlug` argument. During the Diana migration window, omitting it
// resolves to the Diana site (DEFAULT_SITE_SLUG). After Phase 3 wires
// the host-derived header into every callsite, the slug becomes
// effectively required.

type AnyCtx = QueryCtx | MutationCtx;

async function sessionUserForTokenHash(
  ctx: AnyCtx,
  site: SiteCtx,
  tokenHash: string | undefined,
) {
  if (!tokenHash) return null;

  const session = site.siteId
    ? await ctx.db
        .query("userSessions")
        .withIndex("by_site_token", (q) =>
          q.eq("siteId", site.siteId!).eq("tokenHash", tokenHash),
        )
        .first()
    : await ctx.db
        .query("userSessions")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
        .first();

  if (!session || !rowBelongsToSite(session, site)) return null;
  if (session.expiresAt <= Date.now()) return null;

  const user = await ctx.db.get(session.userId);
  if (!user || !rowBelongsToSite(user, site)) return null;
  return user;
}

async function canRevealRawContent(
  ctx: QueryCtx,
  site: SiteCtx,
  tokenHash: string | undefined,
) {
  const user = await sessionUserForTokenHash(ctx, site, tokenHash);
  if (!user) return false;

  if (site.site?.ownerEmail.toLowerCase() === user.email.toLowerCase()) {
    return true;
  }

  const assignments = site.siteId
    ? await ctx.db
        .query("userRoles")
        .withIndex("by_site_user", (q) =>
          q.eq("siteId", site.siteId!).eq("userId", user._id),
        )
        .collect()
    : await ctx.db
        .query("userRoles")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();

  for (const assignment of assignments) {
    if (!rowBelongsToSite(assignment, site)) continue;
    const role = await ctx.db.get(assignment.roleId);
    if (!role || !rowBelongsToSite(role, site)) continue;
    if (role.name.trim().toLowerCase() === "admin") return true;
  }

  return false;
}

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

type AssetVisibilityRow = {
  ownerSlugs?: string[];
  path: string;
  sensitive?: boolean;
};

async function isSensitiveAsset(
  ctx: AnyCtx,
  site: SiteCtx,
  asset: AssetVisibilityRow,
) {
  if (!hasCompleteAssetVisibility(asset)) return true;
  if (asset.sensitive) return true;
  const doc = await findDocBySlug(ctx, site, assetPathToSiblingSlug(asset.path));
  return doc?.sensitive === true;
}

async function canReadAsset(
  ctx: AnyCtx,
  site: SiteCtx,
  asset: AssetVisibilityRow,
  includeSensitive?: boolean,
) {
  return includeSensitive || !(await isSensitiveAsset(ctx, site, asset));
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
  asset: AssetVisibilityRow,
  sensitiveSlugs: Set<string> | null,
) {
  if (sensitiveSlugs === null) return true;
  if (!hasCompleteAssetVisibility(asset)) return false;
  if (asset.sensitive) return false;
  return !sensitiveSlugs?.has(assetPathToSiblingSlug(asset.path));
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
    rawContentSessionTokenHash: v.optional(v.string()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { slug, includeSensitive, rawContentSessionTokenHash, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc || !canReadDocument(doc, includeSensitive)) return null;
    const revealRawContent = await canRevealRawContent(
      ctx,
      site,
      rawContentSessionTokenHash,
    );
    return {
      slug: doc.slug,
      title: doc.title,
      content: revealRawContent ? doc.rawContent ?? doc.content : doc.content,
      tags: doc.tags,
      sensitiveInclude: doc.sensitiveInclude ?? [],
      description: doc.description,
      contentHash: doc.contentHash,
      hashFunctionVersion: doc.hashFunctionVersion,
      sensitive: doc.sensitive,
    };
  },
});

async function findReaderSite(ctx: QueryCtx, host: string, previewSiteSlug?: string) {
  const normalized = host.trim().toLowerCase().split(":")[0];
  const site = previewSiteSlug && normalized.endsWith(".vercel.app")
    ? await ctx.db.query("sites").withIndex("by_slug", q => q.eq("slug", previewSiteSlug)).first()
    : (await ctx.db.query("sites").collect()).find(site => site.domains.includes(normalized));
  return site?.status === "active" ? site : null;
}

function readerPolicy(site: NonNullable<Awaited<ReturnType<typeof findReaderSite>>>) {
  return {
    siteSlug: site.slug,
    // Every published document/visibility mutation advances this revision in
    // its transaction. The site id also protects deletion/recreation of a slug.
    contentRevision: `${site._id}:${site.manifestRevision ?? 0}`,
    gate: { enabled: site.config.passwordGate, passwordHash: site.config.passwordHash },
    piiPatterns: site.config.piiPatterns,
  };
}

export const getReaderPolicy = query({
  args: { host: v.string(), previewSiteSlug: v.optional(v.string()) },
  handler: async (ctx, { host, previewSiteSlug }) => {
    const site = await findReaderSite(ctx, host, previewSiteSlug);
    return site ? readerPolicy(site) : null;
  },
});

// One consistent read of host, gate/redaction policy and public document.
// Convex invalidates its query result when any of those records changes.
// Never includes rawContent, restricted documents or account permissions.
export const getReaderPage = query({
  args: { host: v.string(), slug: v.string(), previewSiteSlug: v.optional(v.string()),
    metadataOnly: v.optional(v.boolean()),
    knownBody: v.optional(v.object({ siteSlug: v.string(), digest: v.string() })) },
  handler: async (ctx, { host, slug, previewSiteSlug, knownBody, metadataOnly }) => {
    const site = await findReaderSite(ctx, host, previewSiteSlug);
    if (!site) return null;
    const doc = await findDocBySlug(ctx, { siteId: site._id, siteSlug: site.slug, site }, slug);
    const publicDoc = doc && !doc.deletedAt && doc.sensitive === false ? doc : null;
    // Hash actual published bytes, not just the publisher's source revision:
    // publishing/redaction can replace content without changing contentHash.
    const bodyDigest = publicDoc ? bytesToHex(sha256(new TextEncoder().encode(publicDoc.content))) : null;
    return {
      ...readerPolicy(site),
      page: publicDoc ? {
        slug: publicDoc.slug, title: publicDoc.title,
        content: metadataOnly || (knownBody?.siteSlug === site.slug && knownBody.digest === bodyDigest) ? null : publicDoc.content,
        bodyDigest,
        tags: publicDoc.tags, contentHash: publicDoc.contentHash, description: publicDoc.description, sensitive: false as const,
      } : null,
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
    sensitiveOnly: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, sensitiveOnly, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    // Access-aware session keys need only explicitly sensitive slugs. Use the
    // existing index before pagination so public bodies never enter this scan.
    // This selector does not grant access: retain the normal visibility checks.
    const result = sensitiveOnly && site.siteId
      ? await ctx.db.query("documents")
          .withIndex("by_site_sensitive_slug", q => q.eq("siteId", site.siteId!).eq("sensitive", true))
          .paginate({ cursor, numItems })
      : await paginatedDocs(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive) && (!sensitiveOnly || doc.sensitive === true))
        .map(({ slug, title, tags, sensitiveInclude, sensitive }) => ({
          slug,
          title,
          tags,
          sensitiveInclude: sensitiveInclude ?? [],
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
        .map(({ slug, title, content, tags, sensitiveInclude, contentHash, sensitive }) => ({
          slug,
          title,
          content,
          tags,
          sensitiveInclude: sensitiveInclude ?? [],
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
    // Deleted documents retain large bodies. Exclude them in the index, before
    // pagination's byte limit. Keep legacy deletedAt=0 semantics through a second
    // indexed partition; opaque cursors carry both partition and native cursor.
    let partition = 0;
    let nativeCursor: string | null = null;
    if (cursor) {
      const parsed: unknown = JSON.parse(cursor);
      if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== "manifest-v2" ||
          ![0, 1].includes(parsed[1]) || (parsed[2] !== null && typeof parsed[2] !== "string")) {
        throw new Error("Invalid manifest cursor");
      }
      partition = parsed[1];
      nativeCursor = parsed[2];
    }
    const result = site.siteId
      ? await ctx.db.query("documents")
          .withIndex("by_site_deleted_sensitive_slug", (q) => {
            const active = q.eq("siteId", site.siteId!).eq("deletedAt", partition === 0 ? undefined : 0);
            // Undefined and false sensitivity both remain publicly readable.
            return includeSensitive ? active : active.lt("sensitive", true);
          })
          .paginate({ cursor: nativeCursor, numItems })
      : { page: [], isDone: true, continueCursor: "" };
    const nextPartition = result.isDone ? partition + 1 : partition;
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, title, tags, description, content, contentHash, sensitive, sizeBytes }) => ({
          slug,
          title,
          tags,
          description: description ?? null,
          contentHash: contentHash ?? null,
          sensitive: sensitive === true,
          size: sizeBytes ?? content.length,
        })),
      isDone: result.isDone && (partition === 1 || !site.siteId),
      continueCursor: JSON.stringify(["manifest-v2", nextPartition, result.isDone ? null : result.continueCursor]),
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
  ): Promise<
    Array<{
      slug: string;
      title: string;
      tags: string[];
      sensitiveInclude?: string[];
      sensitive?: boolean;
    }>
  > => {
    const results: Array<{
      slug: string;
      title: string;
      tags: string[];
      sensitiveInclude?: string[];
      sensitive?: boolean;
    }> = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const page: {
        page: Array<{
          slug: string;
          title: string;
          tags: string[];
          sensitiveInclude?: string[];
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
    runId: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    content: v.string(),
    rawContent: v.optional(v.string()),
    replaceRawContent: v.optional(v.boolean()),
    tags: v.array(v.string()),
    sensitiveInclude: v.optional(v.array(v.string())),
    contentHash: v.string(),
    hashFunctionVersion: v.optional(v.number()),
    sensitive: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      siteSlug,
      runId,
      slug,
      title,
      content,
      rawContent,
      replaceRawContent,
      tags,
      sensitiveInclude,
      contentHash,
      hashFunctionVersion,
      sensitive = false,
    },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId, { document: slug });
    const existing = await findDocBySlug(ctx, site, slug);
    const sizeBytes = content.length;
    const cleanedSensitiveInclude = sensitiveInclude ?? [];
    const rawContentChanged =
      (replaceRawContent || rawContent !== undefined) && existing?.rawContent !== rawContent;
    if (existing) {
      if (
        existing.contentHash === contentHash &&
        existing.hashFunctionVersion === hashFunctionVersion &&
        existing.sizeBytes === sizeBytes &&
        existing.title === title && existing.content === content &&
        JSON.stringify(existing.tags) === JSON.stringify(tags) &&
        existing.sensitive === sensitive &&
        !rawContentChanged &&
        JSON.stringify(existing.sensitiveInclude ?? []) ===
          JSON.stringify(cleanedSensitiveInclude) &&
        !existing.deletedAt
      ) {
        return { skipped: true };
      }
      if (!ownedRun) await invalidateManifest(ctx, site.siteId);
      await ctx.db.patch(existing._id, {
        title,
        content,
        ...((replaceRawContent || rawContent !== undefined) ? { rawContent } : {}),
        tags,
        sensitiveInclude: cleanedSensitiveInclude,
        contentHash,
        sizeBytes,
        hashFunctionVersion,
        sensitive,
        siteId: site.siteId ?? existing.siteId,
        deletedAt: undefined,
        updatedAt: Date.now(),
      });
      return { skipped: false };
    }
    if (!ownedRun) await invalidateManifest(ctx, site.siteId);
    await ctx.db.insert("documents", {
      ...(site.siteId ? { siteId: site.siteId } : {}),
      slug,
      title,
      content,
      ...((replaceRawContent || rawContent !== undefined) ? { rawContent } : {}),
      tags,
      sensitiveInclude: cleanedSensitiveInclude,
      contentHash,
      sizeBytes,
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
    runId: v.optional(v.string()),
    slug: v.string(),
    contentHash: v.string(),
  },
  handler: async (ctx, { siteSlug, runId, slug, contentHash }) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId, { document: slug });
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { found: false, patched: false };
    if (doc.contentHash === contentHash) return { found: true, patched: false };
    if (!ownedRun) await invalidateManifest(ctx, site.siteId);
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
    runId: v.optional(v.string()),
    hashFunctionVersion: v.optional(v.number()),
    entries: v.array(
      v.object({ slug: v.string(), contentHash: v.string() }),
    ),
  },
  handler: async (ctx, { siteSlug, runId, hashFunctionVersion, entries }) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId);
    let patched = 0;
    let alreadyMatching = 0;
    let missing = 0;
    for (const { slug, contentHash } of entries) {
      assertPublishRun(site.site, runId, { document: slug });
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
    if (patched && !ownedRun) await invalidateManifest(ctx, site.siteId);
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
    assertPublishRun(site.site, undefined);
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { found: false };
    await invalidateManifest(ctx, site.siteId);
    await ctx.db.patch(doc._id, { description });
    return { found: true };
  },
});

export const deleteBySlug = mutation({
  args: { slug: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { slug, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    assertPublishRun(site.site, undefined, { deletion: true });
    const doc = await findDocBySlug(ctx, site, slug);
    if (!doc) return { deleted: false };
    // Tombstone rather than hard-delete — gives a 90-day undo window.
    // Phase 4's publish/finish writes deletedAt; Phase 6 destroy
    // hard-deletes rows past the retention window.
    await invalidateManifest(ctx, site.siteId);
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
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { embedding, limit, includeSensitive, siteSlug },
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
          includeSensitive,
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
          hasRawContent: doc.rawContent !== undefined,
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
    runId: v.optional(v.string()),
  },
  handler: async (ctx, { slug, embedding, embeddingHash, siteSlug, runId }) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId, { document: slug });
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

export const deleteMeta = mutation({
  args: { key: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { key, siteSlug }) => {
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
    if (!existing || !rowBelongsToSite(existing, site)) return { deleted: false };
    await ctx.db.delete(existing._id);
    return { deleted: true };
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
      if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
      // Trim to the fields consumers use; full rows for the ~11k assets on
      // large sites exceed the Convex query response size limit.
      out.push({
        path: row.path,
        blobUrl: row.blobUrl,
        sizeBytes: row.sizeBytes,
        contentHash: row.contentHash,
      });
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
      if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
      page.push(row.path);
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listPdfAssetVisibilityPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = site.siteId
      ? await ctx.db
          .query("pdfAssets")
          .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
          .paginate({ cursor, numItems })
      : await ctx.db.query("pdfAssets").paginate({ cursor, numItems });
    const page = [];
    for (const row of result.page) {
      if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
      const siblingSlug = assetPathToSiblingSlug(row.path);
      let sibling =
        !hasCompleteAssetVisibility(row) || row.sensitive === true
          ? await findDocBySlug(ctx, site, siblingSlug)
          : null;
      const sensitive =
        !hasCompleteAssetVisibility(row) ||
        row.sensitive === true ||
        sibling?.sensitive === true;
      if (!includeSensitive && sensitive) continue;
      const ownerSlugs = new Set(row.ownerSlugs ?? []);
      if (sensitive) {
        sibling ??= await findDocBySlug(ctx, site, siblingSlug);
        if (sibling) ownerSlugs.add(sibling.slug);
      }
      page.push({
        path: row.path,
        ownerSlugs: [...ownerSlugs],
        sensitive,
      });
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
      !(await canReadAsset(ctx, site, row, includeSensitive))
    ) {
      return null;
    }
    return row;
  },
});

export const upsertPdfAsset = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    runId: v.optional(v.string()),
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
    ownerSlugs: v.optional(v.array(v.string())),
    sensitive: v.optional(v.boolean()),
    sensitiveInclude: v.optional(v.array(v.string())),
    visibilityHash: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      siteSlug,
      runId,
      path,
      blobUrl,
      sizeBytes,
      contentHash,
      ownerSlugs,
      sensitive,
      sensitiveInclude,
      visibilityHash,
    },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId, { asset: `pdf:${path}` });
    if (!ownedRun) await invalidateManifest(ctx, site.siteId);
    const existing = await findAssetByPath(ctx, "pdfAssets", site, path);
    if (existing) {
      await ctx.db.patch(existing._id, {
        blobUrl,
        sizeBytes,
        contentHash,
        ownerSlugs,
        sensitive,
        sensitiveInclude,
        visibilityHash,
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
        ownerSlugs,
        sensitive,
        sensitiveInclude,
        visibilityHash,
        uploadedAt: Date.now(),
      });
    }
  },
});

export const backfillAssetHashes = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    runId: v.optional(v.string()),
    entries: v.array(
      v.object({
        kind: v.union(v.literal("pdf"), v.literal("file")),
        path: v.string(),
        contentHash: v.string(),
        ownerSlugs: v.array(v.string()),
        sensitive: v.boolean(),
        sensitiveInclude: v.array(v.string()),
        visibilityHash: v.string(),
      }),
    ),
  },
  handler: async (ctx, { siteSlug, runId, entries }) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId);
    const result = {
      found: 0,
      patched: 0,
      missing: [] as string[],
      unchanged: 0,
    };

    for (const entry of entries) {
      assertPublishRun(site.site, runId, { asset: `${entry.kind}:${entry.path}` });
      const table = entry.kind === "pdf" ? "pdfAssets" : "fileAssets";
      const row = await findAssetByPath(ctx, table, site, entry.path);
      if (!row || row.deletedAt) {
        result.missing.push(`${entry.kind}:${entry.path}`);
        continue;
      }

      result.found++;
      if (
        row.contentHash === entry.contentHash &&
        row.sensitive === entry.sensitive &&
        JSON.stringify(row.ownerSlugs ?? []) === JSON.stringify(entry.ownerSlugs) &&
        JSON.stringify(row.sensitiveInclude ?? []) ===
          JSON.stringify(entry.sensitiveInclude) &&
        row.visibilityHash === entry.visibilityHash
      ) {
        result.unchanged++;
        continue;
      }

      await ctx.db.patch(row._id, {
        contentHash: entry.contentHash,
        ownerSlugs: entry.ownerSlugs,
        sensitive: entry.sensitive,
        sensitiveInclude: entry.sensitiveInclude,
        visibilityHash: entry.visibilityHash,
        siteId: site.siteId ?? row.siteId,
      });
      result.patched++;
    }

    if (result.patched && !ownedRun) await invalidateManifest(ctx, site.siteId);
    return result;
  },
});

export const deletePdfAssetByPath = mutation({
  args: { path: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { path, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    assertPublishRun(site.site, undefined, { deletion: true });
    const row = await findAssetByPath(ctx, "pdfAssets", site, path);
    if (!row) return { deleted: false };
    await invalidateManifest(ctx, site.siteId);
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
      if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
      // Trim to the fields consumers use; full rows for the ~11k assets on
      // large sites exceed the Convex query response size limit.
      out.push({
        path: row.path,
        blobUrl: row.blobUrl,
        sizeBytes: row.sizeBytes,
        contentHash: row.contentHash,
      });
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
      ownerSlugs?: string[];
      sensitive?: boolean;
      sensitiveInclude?: string[];
      visibilityHash?: string;
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
        if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
        out.push({
          kind: "pdf",
          path: row.path,
          contentHash: row.contentHash,
          sizeBytes: row.sizeBytes,
          blobUrl: row.blobUrl,
          ownerSlugs: row.ownerSlugs,
          sensitive: row.sensitive,
          sensitiveInclude: row.sensitiveInclude,
          visibilityHash: row.visibilityHash,
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
        if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
        out.push({
          kind: "file",
          path: row.path,
          contentHash: row.contentHash,
          sizeBytes: row.sizeBytes,
          blobUrl: row.blobUrl,
          ownerSlugs: row.ownerSlugs,
          sensitive: row.sensitive,
          sensitiveInclude: row.sensitiveInclude,
          visibilityHash: row.visibilityHash,
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
      if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
      page.push(row.path);
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const listFileAssetVisibilityPage = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = site.siteId
      ? await ctx.db
          .query("fileAssets")
          .withIndex("by_site_path", (q) => q.eq("siteId", site.siteId!))
          .paginate({ cursor, numItems })
      : await ctx.db.query("fileAssets").paginate({ cursor, numItems });
    const page = [];
    for (const row of result.page) {
      if (!rowBelongsToSite(row, site) || row.deletedAt) continue;
      const siblingSlug = assetPathToSiblingSlug(row.path);
      let sibling =
        !hasCompleteAssetVisibility(row) || row.sensitive === true
          ? await findDocBySlug(ctx, site, siblingSlug)
          : null;
      const sensitive =
        !hasCompleteAssetVisibility(row) ||
        row.sensitive === true ||
        sibling?.sensitive === true;
      if (!includeSensitive && sensitive) continue;
      const ownerSlugs = new Set(row.ownerSlugs ?? []);
      if (sensitive) {
        sibling ??= await findDocBySlug(ctx, site, siblingSlug);
        if (sibling) ownerSlugs.add(sibling.slug);
      }
      page.push({
        path: row.path,
        ownerSlugs: [...ownerSlugs],
        sensitive,
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});


export const listPdfAssetsPage = query({
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
      if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
      page.push({
        path: row.path,
        blobUrl: row.blobUrl,
        sizeBytes: row.sizeBytes,
        contentHash: row.contentHash,
      });
    }
    return {
      page,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});


export const listFileAssetsPage = query({
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
      if (!canReadAssetWithSensitiveSlugs(row, sensitiveSlugs)) continue;
      page.push({
        path: row.path,
        blobUrl: row.blobUrl,
        sizeBytes: row.sizeBytes,
        contentHash: row.contentHash,
      });
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
      !(await canReadAsset(ctx, site, row, includeSensitive))
    ) {
      return null;
    }
    return row;
  },
});

export const upsertFileAsset = mutation({
  args: {
    siteSlug: v.optional(v.string()),
    runId: v.optional(v.string()),
    path: v.string(),
    blobUrl: v.string(),
    sizeBytes: v.number(),
    contentHash: v.optional(v.string()),
    ownerSlugs: v.optional(v.array(v.string())),
    sensitive: v.optional(v.boolean()),
    sensitiveInclude: v.optional(v.array(v.string())),
    visibilityHash: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      siteSlug,
      runId,
      path,
      blobUrl,
      sizeBytes,
      contentHash,
      ownerSlugs,
      sensitive,
      sensitiveInclude,
      visibilityHash,
    },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const ownedRun = assertPublishRun(site.site, runId, { asset: `file:${path}` });
    if (!ownedRun) await invalidateManifest(ctx, site.siteId);
    const existing = await findAssetByPath(ctx, "fileAssets", site, path);
    if (existing) {
      await ctx.db.patch(existing._id, {
        blobUrl,
        sizeBytes,
        contentHash,
        ownerSlugs,
        sensitive,
        sensitiveInclude,
        visibilityHash,
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
        ownerSlugs,
        sensitive,
        sensitiveInclude,
        visibilityHash,
        uploadedAt: Date.now(),
      });
    }
  },
});

export const deleteFileAssetByPath = mutation({
  args: { path: v.string(), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { path, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    assertPublishRun(site.site, undefined, { deletion: true });
    const row = await findAssetByPath(ctx, "fileAssets", site, path);
    if (!row) return { deleted: false };
    await invalidateManifest(ctx, site.siteId);
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

// Private entrypoints for the scheduled manifest builder.
export const internal_listManifestPage = internalQueryFor(listManifestPage);
export const internal_listPageWithContent = internalQueryFor(listPageWithContent);
export const internal_listPdfAssetPathsPage = internalQueryFor(listPdfAssetPathsPage);
export const internal_listFileAssetPathsPage = internalQueryFor(listFileAssetPathsPage);
export const internal_listPdfAssetVisibilityPage = internalQueryFor(listPdfAssetVisibilityPage);
export const internal_listFileAssetVisibilityPage = internalQueryFor(listFileAssetVisibilityPage);
export const internal_getBySlug = internalQueryFor(getBySlug);

// Bounded, indexed reads. Never return document bodies to the publisher.
// Sixteen maximum-size stored documents fit within Convex's query read budget.
export const publisherState = query({
  args: {
    siteSlug: v.string(),
    slugs: v.array(v.string()),
    assets: v.array(v.object({ path: v.string(), kind: v.union(v.literal("pdf"), v.literal("file")) })),
  },
  handler: async (ctx, { siteSlug, slugs, assets }) => {
    if (slugs.length > 16 || assets.length > 128) throw new Error("Publish state batch exceeds limit");
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) throw new Error("Publish state requires a registered site");
    const patterns = parseSitePiiPatterns(site.site?.config.piiPatterns);
    const digest = (value: unknown) => bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value)))).slice(0, 16);
    const documents = await Promise.all(slugs.map(async slug => {
      const doc = await findDocBySlug(ctx, site, slug);
      if (!doc || doc.deletedAt) return { slug, exists: false as const };
      const observedHash = doc.rawContent === undefined ? null : digest({
        title: doc.title, content: doc.rawContent, tags: doc.tags,
        sensitive: doc.sensitive === true, sensitiveInclude: doc.sensitiveInclude ?? [],
      });
      return { slug, exists: true as const, contentHash: doc.contentHash ?? null,
        observedHash,
        readerContentConsistent: doc.rawContent === undefined ? null : applyPiiRedactions(doc.rawContent, { patterns }) === doc.content,
        hashFunctionVersion: doc.hashFunctionVersion ?? 0,
        sensitive: doc.sensitive === true, sensitiveInclude: doc.sensitiveInclude ?? [],
      };
    }));
    const assetStates = await Promise.all(assets.map(async ({ path, kind }) => {
      const table = kind === "pdf" ? "pdfAssets" : "fileAssets";
      const asset = await findAssetByPath(ctx, table, site, path);
      if (!asset || asset.deletedAt) return { path, kind, exists: false as const };
      return { path, kind, exists: true as const, contentHash: asset.contentHash ?? null,
        visibilityHash: asset.visibilityHash ?? null,
        observedVisibilityHash: digest({ ownerSlugs: asset.ownerSlugs ?? [], sensitive: asset.sensitive === true, sensitiveInclude: asset.sensitiveInclude ?? [] }),
        hasVisibility: Array.isArray(asset.ownerSlugs) && typeof asset.sensitive === "boolean",
        hasBlob: Boolean(asset.blobUrl), sizeBytes: asset.sizeBytes,
      };
    }));
    return { version: 1 as const, documents, assets: assetStates };
  },
});

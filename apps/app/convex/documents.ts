import { internalQuery } from "./_generated/server";
import { internalQueryFor } from "./lib/serviceFunctions";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./lib/serviceFunctions";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";
import { invalidateManifest } from "./lib/manifestRevision";
import { assertPublishRun, recordPublishChange } from "./lib/publishRun";
import { hasCompleteAssetVisibility } from "./lib/assetVisibility";
import {
  collectDocumentMetadata,
  documentMetaReady,
  findDocumentMetadata,
  findDocumentMetadataById,
  insertDocument,
  paginateDocumentMetadata,
  paginateMetadataSource,
  patchDocument,
  type MetadataPage,
} from "./lib/documentMeta";
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
  const doc = await findDocumentMetadata(ctx, site, assetPathToSiblingSlug(asset.path));
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

// Runs on every public asset listing page. Once the site's meta projection is
// ready this reads small meta rows rather than every sensitive body.
async function sensitiveSiblingSlugSet(ctx: QueryCtx, site: SiteCtx) {
  if (!site.siteId) return new Set<string>();
  const siteId = site.siteId;
  const sensitiveDocs = await collectDocumentMetadata(ctx, { ...site, siteId }, "by_site_sensitive_slug", (q) =>
    q.eq("siteId", siteId).eq("sensitive", true),
  );
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

// Readable rows, expressed as equality filters: Convex search filters are
// equality-only and ANDed. Writers store `sensitive` as a boolean and clear
// `deletedAt` to undefined; legacy rows may hold sensitive undefined or the
// readable tombstone value deletedAt=0. Each combination is one search, so a
// restricted or deleted row never occupies a result slot or a document read.
// Combinations no row uses return nothing and read nothing. Listed in index
// order (undefined sorts before 0 and false), the order of the visibility
// index ranges that listPageWithContent reads.
const READABLE_SEARCH_FILTERS = {
  public: [
    { deletedAt: undefined, sensitive: undefined },
    { deletedAt: undefined, sensitive: false },
    { deletedAt: 0, sensitive: undefined },
    { deletedAt: 0, sensitive: false },
  ],
  session: [{ deletedAt: undefined }, { deletedAt: 0 }],
} as const;

export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { query: q, limit, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    // rowBelongsToSite rejects every row of an unregistered site.
    if (!siteId) return [];
    const take = limit ?? 10;
    const filters: ReadonlyArray<{ deletedAt?: 0; sensitive?: boolean }> = includeSensitive
      ? READABLE_SEARCH_FILTERS.session
      : READABLE_SEARCH_FILTERS.public;

    // Every returned row is read whole (body, raw body, embedding), so read at
    // most `take` per index and visibility combination, rather than
    // over-fetching to make room for rows filtered out afterwards.
    const ranked = (index: "search_content" | "search_title", field: "content" | "title") =>
      Promise.all(filters.map((filter) => ctx.db
        .query("documents")
        .withSearchIndex(index, (s) => {
          const scoped = s.search(field, q).eq("siteId", siteId).eq("deletedAt", filter.deletedAt);
          return "sensitive" in filter ? scoped.eq("sensitive", filter.sensitive) : scoped;
        })
        .take(take))).then((groups) => groups.flat());
    const [titleResults, contentResults] = await Promise.all([
      ranked("search_title", "title"),
      ranked("search_content", "content"),
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

// Before the site's meta backfill each lookup reads the stored row (body +
// embedding); 100 keeps a batch well under Convex's read budget.
const SLUG_SENSITIVITY_BATCH_LIMIT = 100;

/** Sensitivity flags for a bounded set of slugs. Callers that only need to
 * know whether a slug is restricted (comment rooms, download assets) use this
 * instead of `getBySlug`, so bodies and embeddings never leave the backend.
 * Missing or deleted documents are omitted, matching `getBySlug` -> null. */
export const getSensitivityBySlugs = query({
  args: { slugs: v.array(v.string()), siteSlug: v.optional(v.string()) },
  handler: async (ctx, { slugs, siteSlug }) => {
    if (slugs.length > SLUG_SENSITIVITY_BATCH_LIMIT) {
      throw new Error(`At most ${SLUG_SENSITIVITY_BATCH_LIMIT} slugs per call`);
    }
    const site = await requireSite(ctx, siteSlug);
    const results: { slug: string; sensitive: boolean }[] = [];
    for (const slug of new Set(slugs)) {
      const doc = await findDocumentMetadata(ctx, site, slug);
      if (!doc || doc.deletedAt) continue;
      results.push({ slug, sensitive: doc.sensitive === true });
    }
    return results;
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

async function paginatedMetadata(ctx: QueryCtx, site: SiteCtx, cursor: string | null, numItems: number): Promise<MetadataPage> {
  const siteId = site.siteId;
  // Unscoped rows never pass rowBelongsToSite; keep the legacy scan's shape.
  if (!siteId) return { page: [], isDone: true, continueCursor: "" };
  return await paginateDocumentMetadata(ctx, { ...site, siteId }, "by_site_slug", (q) => q.eq("siteId", siteId), { cursor, numItems });
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
      ? await paginateDocumentMetadata(ctx, { ...site, siteId: site.siteId }, "by_site_sensitive_slug",
          q => q.eq("siteId", site.siteId!).eq("sensitive", true), { cursor, numItems })
      : await paginatedMetadata(ctx, site, cursor, numItems);
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

// Readable rows of a site in the visibility index: active rows (deletedAt
// undefined) then legacy deletedAt=0 rows, optionally public only. Tombstones
// and (public scope) restricted rows are excluded before pagination's byte
// limit, so their stored bodies are never read.
function visibleRange(siteId: Id<"sites">, partition: 0 | 1, includeSensitive: boolean | undefined) {
  return (q: any) => {
    const active = q.eq("siteId", siteId).eq("deletedAt", partition === 0 ? undefined : 0);
    // Undefined and false sensitivity both remain publicly readable.
    return includeSensitive ? active : active.lt("sensitive", true);
  };
}

type VisibleCursor = { partition: 0 | 1; cursor: string | null };

function parseVisibleCursor(raw: unknown, tag: string): VisibleCursor | null {
  if (!Array.isArray(raw) || raw[0] !== tag) return null;
  if (raw.length !== 3 || ![0, 1].includes(raw[1]) || (raw[2] !== null && typeof raw[2] !== "string")) {
    throw new Error("Invalid manifest cursor");
  }
  return { partition: raw[1], cursor: raw[2] };
}

function parseJsonCursor(cursor: string): unknown {
  try { return JSON.parse(cursor); } catch { return null; }
}

function nextVisibleCursor(tag: string, partition: 0 | 1, result: MetadataPage | { isDone: boolean; continueCursor: string }) {
  return JSON.stringify([tag, result.isDone ? partition + 1 : partition, result.isDone ? null : result.continueCursor]);
}

export const listPageWithContent = query({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const toPage = (docs: Doc<"documents">[]) => docs
      .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
      .map(({ slug, title, content, tags, sensitiveInclude, contentHash, sensitive }) => ({
        slug,
        title,
        content,
        tags,
        sensitiveInclude: sensitiveInclude ?? [],
        contentHash,
        sensitive,
      }));
    const parsed = cursor === null ? { partition: 0 as const, cursor: null } : parseVisibleCursor(parseJsonCursor(cursor), "content-v2");
    if (!parsed || !site.siteId) {
      // Cursor issued before the visibility-index read (raw by_site_slug
      // cursor), or an unregistered site: finish on the original path.
      const result = await paginatedDocs(ctx, site, cursor, numItems);
      return { page: toPage(result.page), isDone: result.isDone, continueCursor: result.continueCursor };
    }
    // Same partitioned visibility index as listManifestPage: tombstones and,
    // in public scope, restricted bodies never enter the page read.
    const result = await ctx.db.query("documents")
      .withIndex("by_site_deleted_sensitive_slug", visibleRange(site.siteId, parsed.partition, includeSensitive))
      .paginate({ cursor: parsed.cursor, numItems });
    return {
      page: toPage(result.page),
      isDone: result.isDone && parsed.partition === 1,
      continueCursor: nextVisibleCursor("content-v2", parsed.partition, result),
    };
  },
});

// Public text-search corpus, read as independent slug ranges so the server can
// fetch them in parallel instead of one sequential cursor chain. Ranges come
// from the visibility index with equality on every prefix field (a slug range
// may only follow equalities), one partition per readable public combination
// (see READABLE_SEARCH_FILTERS). Restricted rows and tombstones are never read.
const SEARCH_CORPUS_PARTITIONS = READABLE_SEARCH_FILTERS.public;
// Stored bytes, not returned bytes: a range read also loads each row's raw
// body and embedding. Well under the 16 MiB per-function read limit even when
// `size` (UTF-16 length) undercounts multi-byte UTF-8 text.
const SEARCH_CORPUS_RANGE_BYTES = 4 * 1024 * 1024;
const EMBEDDING_STORED_BYTES = 1536 * 8 + 1024;
const SEARCH_CORPUS_PAGE_ITEMS = 1000;

function searchPartitionRange(siteId: Id<"sites">, partition: number, from: string | null, to: string | null) {
  const visibility = SEARCH_CORPUS_PARTITIONS[partition];
  if (!visibility || !Number.isInteger(partition)) throw new Error("Invalid search partition");
  return (q: any) => {
    let range = q.eq("siteId", siteId).eq("deletedAt", visibility.deletedAt).eq("sensitive", visibility.sensitive);
    if (from !== null) range = range.gte("slug", from);
    if (to !== null) range = range.lt("slug", to);
    return range;
  };
}

/** Contiguous slug ranges covering every public partition, sized from the
 * body-free projection. The first range of a partition is open below and the
 * last open above, so rows written after planning still fall in exactly one
 * range. Each planned range carries a fingerprint of its rows' identity and
 * versions (slug, title, content hash, update time), so a reader holding that
 * range's previous result can skip the read. Before the site's projection is
 * ready, each partition is one unfingerprinted range (read with continuation
 * cursors, as the sequential reader did). */
export const searchCorpusPlan = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    type Range = { partition: number; from: string | null; to: string | null; fingerprint: string | null };
    if (!siteId) return { ranges: [] as Range[], documents: 0, planned: false };
    if (!documentMetaReady(site)) {
      return { ranges: SEARCH_CORPUS_PARTITIONS.map((_, partition): Range => ({ partition, from: null, to: null, fingerprint: null })), documents: null, planned: false };
    }
    const ranges: Range[] = [];
    let documents = 0;
    for (let partition = 0; partition < SEARCH_CORPUS_PARTITIONS.length; partition++) {
      const rows = await ctx.db.query("documentMeta")
        .withIndex("by_site_deleted_sensitive_slug", searchPartitionRange(siteId, partition, null, null))
        .collect();
      if (!rows.length) continue;
      documents += rows.length;
      let from: string | null = null;
      let bytes = 0;
      let identity: string[] = [];
      const close = (to: string | null) => {
        const fingerprint = bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(identity)))).slice(0, 32);
        ranges.push({ partition, from, to, fingerprint });
      };
      for (const row of rows) {
        const stored = row.size * (row.hasRawContent ? 2 : 1) + (row.embeddingHash ? EMBEDDING_STORED_BYTES : 0) + 1024;
        if (bytes > 0 && bytes + stored > SEARCH_CORPUS_RANGE_BYTES) {
          close(row.slug);
          from = row.slug;
          bytes = 0;
          identity = [];
        }
        bytes += stored;
        identity.push(row.slug, row.title, row.contentHash ?? "", String(row.updatedAt));
      }
      close(null);
    }
    return { ranges, documents, planned: true };
  },
});

/** One page of a planned public range: only what text search needs. */
export const listSearchPages = query({
  args: {
    partition: v.number(),
    from: v.union(v.string(), v.null()),
    to: v.union(v.string(), v.null()),
    cursor: v.union(v.string(), v.null()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { partition, from, to, cursor, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const siteId = site.siteId;
    if (!siteId) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("documents")
      .withIndex("by_site_deleted_sensitive_slug", searchPartitionRange(siteId, partition, from, to))
      .paginate({ cursor, numItems: SEARCH_CORPUS_PAGE_ITEMS });
    return {
      page: result.page
        // The range already excludes them; keep the shared visibility rule.
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, false))
        .map(({ slug, title, content, contentHash }) => ({ slug, title, content, contentHash })),
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
    // indexed partition; opaque cursors carry source, partition and native cursor.
    // "manifest-v2" pages `documents`; "manifest-meta-v1" pages `documentMeta`.
    // A continuation stays on the source it started on.
    let tag = documentMetaReady(site) ? "manifest-meta-v1" : "manifest-v2";
    let position: VisibleCursor = { partition: 0, cursor: null };
    if (cursor) {
      const raw = parseJsonCursor(cursor);
      const parsed = parseVisibleCursor(raw, "manifest-v2") ?? parseVisibleCursor(raw, "manifest-meta-v1");
      if (!parsed) throw new Error("Invalid manifest cursor");
      tag = (raw as unknown[])[0] as string;
      position = parsed;
    }
    const result: MetadataPage = site.siteId
      ? await paginateMetadataSource(ctx, tag === "manifest-v2" ? "documents" : "documentMeta", "by_site_deleted_sensitive_slug",
          visibleRange(site.siteId, position.partition, includeSensitive), { cursor: position.cursor, numItems })
      : { page: [], isDone: true, continueCursor: "" };
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map(({ slug, title, tags, description, contentHash, sensitive, size }) => ({
          slug,
          title,
          tags,
          description: description ?? null,
          contentHash: contentHash ?? null,
          sensitive: sensitive === true,
          size,
        })),
      isDone: result.isDone && (position.partition === 1 || !site.siteId),
      continueCursor: nextVisibleCursor(tag, position.partition, result),
    };
  },
});

/** One page of documents carrying `tag`, for server-driven tag listings
 * (server/document-listing.ts). Filtering happens here so only matching
 * {slug,title,sensitive} rows cross the network; each call reads one bounded
 * page instead of an action fanning out over the whole corpus. */
export const listByTagPage = query({
  args: {
    tag: v.string(),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { tag, cursor, numItems, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const result = await paginatedMetadata(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive) && doc.tags.includes(tag))
        .map(({ slug, title, sensitive }) => ({ slug, title, sensitive })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
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
      await recordPublishChange(ctx, site.site, ownedRun, (existing.sensitive === true) !== sensitive ? undefined : slug);
      await patchDocument(ctx, existing, {
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
    await recordPublishChange(ctx, site.site, ownedRun, sensitive ? undefined : slug);
    await insertDocument(ctx, {
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

// Overwrite contentHash/hashFunctionVersion for a batch of docs without
// touching other fields. One mutation per batch of 200 rows (rather than one
// per document)
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
      await patchDocument(ctx, doc, { contentHash, hashFunctionVersion });
      if (ownedRun) await recordPublishChange(ctx, site.site, ownedRun, slug);
      patched++;
    }
    if (patched && !ownedRun) await recordPublishChange(ctx, site.site, false);
    return { patched, alreadyMatching, missing };
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
    await patchDocument(ctx, doc, { deletedAt: Date.now() });
    return { deleted: true };
  },
});

// Vector hits are ids; resolve them in one transaction instead of one
// runQuery per hit. Internal: only vectorSearch calls it.
export const searchHitsByIds = internalQuery({
  args: {
    ids: v.array(v.id("documents")),
    includeSensitive: v.optional(v.boolean()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { ids, includeSensitive, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    // Metadata only: never reads bodies or embeddings once documentMeta is ready.
    const docs = await Promise.all(ids.map((id) => findDocumentMetadataById(ctx, site, id)));
    return docs.map((doc) =>
      doc && rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive)
        ? { slug: doc.slug, title: doc.title, tags: doc.tags }
        : null,
    );
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
    if (results.length === 0) return [];

    const docs = await ctx.runQuery(internal.documents.searchHitsByIds, {
      ids: results.map((r) => r._id),
      includeSensitive,
      siteSlug,
    });
    return results.flatMap((r, i) => {
      const doc = docs[i];
      return doc ? [{ slug: doc.slug, title: doc.title, tags: doc.tags, score: r._score }] : [];
    });
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
    const result = await paginatedMetadata(ctx, site, cursor, numItems);
    return {
      page: result.page
        .filter((doc) => rowBelongsToSite(doc, site) && canReadDocument(doc, includeSensitive))
        .map((doc) => ({
          slug: doc.slug,
          contentHash: doc.contentHash,
          hasRawContent: doc.hasRawContent,
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
    await patchDocument(ctx, doc, { embedding, embeddingHash });
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
      // Complete, non-sensitive visibility is trusted as public. Anything else
      // is sensitive regardless of the sibling, so public scope skips it
      // before any document read (a full public page of sensitive assets used
      // to read one sibling body each and could exceed the read limit).
      const sensitive = !hasCompleteAssetVisibility(row) || row.sensitive === true;
      if (!includeSensitive && sensitive) continue;
      const ownerSlugs = new Set(row.ownerSlugs ?? []);
      if (sensitive) {
        const sibling = await findDocumentMetadata(ctx, site, assetPathToSiblingSlug(row.path));
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
    await recordPublishChange(ctx, site.site, ownedRun);
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

    if (result.patched) await recordPublishChange(ctx, site.site, ownedRun);
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
      // Complete, non-sensitive visibility is trusted as public. Anything else
      // is sensitive regardless of the sibling, so public scope skips it
      // before any document read (a full public page of sensitive assets used
      // to read one sibling body each and could exceed the read limit).
      const sensitive = !hasCompleteAssetVisibility(row) || row.sensitive === true;
      if (!includeSensitive && sensitive) continue;
      const ownerSlugs = new Set(row.ownerSlugs ?? []);
      if (sensitive) {
        const sibling = await findDocumentMetadata(ctx, site, assetPathToSiblingSlug(row.path));
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
    await recordPublishChange(ctx, site.site, ownedRun);
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

// Small indexed metadata reads for a document-only projection update.
export const internal_publisherManifestPages = internalQuery({
  args: { siteSlug: v.string(), slugs: v.array(v.string()) },
  handler: async (ctx, { siteSlug, slugs }) => {
    if (slugs.length > 16) throw new Error("Manifest delta batch exceeds limit");
    const site = await requireSite(ctx, siteSlug);
    return Promise.all(slugs.map(async slug => {
      const doc = await findDocumentMetadata(ctx, site, slug);
      if (!doc || doc.deletedAt || doc.sensitive === true) return null;
      return { slug: doc.slug, title: doc.title, tags: doc.tags, description: doc.description ?? null,
        contentHash: doc.contentHash ?? null, sensitive: false, size: doc.size };
    }));
  },
});

/**
 * `documentMeta` is a body-free projection of `documents`.
 *
 * Convex always reads whole rows, so a metadata query over `documents` also
 * reads `content`, `rawContent` and the 1536-float embedding. Hot metadata
 * paths (manifest pages, access checks, sensitivity lookups, asset sibling
 * checks, prefetch ranking) read `documentMeta` instead once a site has been
 * backfilled.
 *
 * Invariants:
 * - Every write to `documents` goes through `insertDocument`/`patchDocument`
 *   (or calls `syncDocumentMeta` directly) in the same transaction, so the
 *   projection can never lag its source row.
 * - Only site-scoped documents have a meta row. `rowBelongsToSite` rejects
 *   unscoped rows everywhere, so readers never needed them.
 * - Readers switch per site on `sites.documentMetaReadyAt`, which the
 *   backfill sets only after every document of that site has a meta row.
 *   Paginated readers tag their cursors with the source they came from, so a
 *   pagination that started on one table finishes on it even if the flag
 *   flips (or is cleared for rollback) mid-way.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { SiteCtx } from "./site";

/** Metadata shared by both sources. Undefined/false/0 are preserved exactly:
 * the copied indexes rely on them to partition the same way. */
export type DocumentMetadata = {
  siteId?: Id<"sites">;
  slug: string;
  title: string;
  tags: string[];
  description?: string;
  contentHash?: string;
  hashFunctionVersion?: number;
  size: number;
  sensitive?: boolean;
  sensitiveInclude?: string[];
  hasRawContent: boolean;
  embeddingHash?: string;
  updatedAt: number;
  deletedAt?: number;
};

type DocumentFields = Omit<Doc<"documents">, "_id" | "_creationTime">;
type MetaFields = Omit<Doc<"documentMeta">, "_id" | "_creationTime">;
export type MetadataIndex = "by_site_slug" | "by_site_sensitive_slug" | "by_site_deleted_sensitive_slug";
export type MetadataSource = "documents" | "documentMeta";
type ScopedSite = SiteCtx & { siteId: Id<"sites"> };

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

/** The one projection used both to write meta rows and to read the legacy
 * path, so both sources return identical shapes. */
export function documentMetadata(doc: DocumentFields): DocumentMetadata {
  return compact({
    siteId: doc.siteId,
    slug: doc.slug,
    title: doc.title,
    tags: doc.tags,
    description: doc.description,
    contentHash: doc.contentHash,
    hashFunctionVersion: doc.hashFunctionVersion,
    size: doc.sizeBytes ?? doc.content.length,
    sensitive: doc.sensitive,
    sensitiveInclude: doc.sensitiveInclude,
    hasRawContent: doc.rawContent !== undefined,
    embeddingHash: doc.embeddingHash,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt,
  });
}

function metadataFromMeta(row: Doc<"documentMeta">): DocumentMetadata {
  const { _id, _creationTime, documentId, ...metadata } = row;
  void _id; void _creationTime; void documentId;
  return compact(metadata);
}

function sameFields(row: Doc<"documentMeta">, fields: MetaFields) {
  const { _id, _creationTime, ...stored } = row;
  void _id; void _creationTime;
  const keys = new Set([...Object.keys(stored), ...Object.keys(fields)]);
  for (const key of keys) {
    if (JSON.stringify((stored as Record<string, unknown>)[key]) !== JSON.stringify((fields as Record<string, unknown>)[key])) return false;
  }
  return true;
}

export type SyncResult = "inserted" | "updated" | "deleted" | "unchanged";

/** Make the meta row for `documentId` match `doc` (its state after the write
 * in this transaction; null if the document no longer exists). Idempotent. */
export async function syncDocumentMeta(ctx: MutationCtx, documentId: Id<"documents">, doc: DocumentFields | null): Promise<SyncResult> {
  const existing = await ctx.db.query("documentMeta").withIndex("by_document", q => q.eq("documentId", documentId)).collect();
  const [current, ...duplicates] = existing;
  for (const duplicate of duplicates) await ctx.db.delete(duplicate._id);
  if (!doc?.siteId) {
    if (!current) return duplicates.length ? "deleted" : "unchanged";
    await ctx.db.delete(current._id);
    return "deleted";
  }
  const fields = { ...documentMetadata(doc), siteId: doc.siteId, documentId } as MetaFields;
  if (!current) {
    await ctx.db.insert("documentMeta", fields);
    return "inserted";
  }
  if (sameFields(current, fields)) return duplicates.length ? "updated" : "unchanged";
  await ctx.db.replace(current._id, fields);
  return "updated";
}

export async function insertDocument(ctx: MutationCtx, value: DocumentFields) {
  const id = await ctx.db.insert("documents", value);
  await syncDocumentMeta(ctx, id, value);
  return id;
}

/** `ctx.db.patch` plus meta sync, computing the post-patch row in memory so
 * the (large) document is not read a second time. Undefined removes a field,
 * matching Convex patch semantics. */
export async function patchDocument(ctx: MutationCtx, existing: Doc<"documents">, patch: Partial<DocumentFields>) {
  await ctx.db.patch(existing._id, patch);
  const next: Record<string, unknown> = { ...existing, ...patch };
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  await syncDocumentMeta(ctx, existing._id, next as unknown as DocumentFields);
}

export function documentMetaReady(site: SiteCtx): site is ScopedSite {
  return Boolean(site.siteId && site.site?.documentMetaReadyAt);
}

/** Metadata for one slug in the site, tombstones included (callers decide).
 * The legacy unscoped `by_slug` fallback is omitted: rowBelongsToSite requires
 * the same siteId, so any row it could accept is found by `by_site_slug`. */
export async function findDocumentMetadata(ctx: QueryCtx | MutationCtx, site: SiteCtx, slug: string): Promise<DocumentMetadata | null> {
  const siteId = site.siteId;
  if (!siteId) return null;
  if (documentMetaReady(site)) {
    const row = await ctx.db.query("documentMeta").withIndex("by_site_slug", q => q.eq("siteId", siteId).eq("slug", slug)).first();
    return row ? metadataFromMeta(row) : null;
  }
  const doc = await ctx.db.query("documents").withIndex("by_site_slug", q => q.eq("siteId", siteId).eq("slug", slug)).first();
  return doc ? documentMetadata(doc) : null;
}

export async function findDocumentMetadataById(ctx: QueryCtx, site: SiteCtx, documentId: Id<"documents">): Promise<DocumentMetadata | null> {
  if (documentMetaReady(site)) {
    const row = await ctx.db.query("documentMeta").withIndex("by_document", q => q.eq("documentId", documentId)).first();
    return row ? metadataFromMeta(row) : null;
  }
  const doc = await ctx.db.get(documentId);
  return doc ? documentMetadata(doc) : null;
}

/** Every row of the site's index range, as metadata. */
export async function collectDocumentMetadata(
  ctx: QueryCtx,
  site: ScopedSite,
  index: MetadataIndex,
  // Both tables declare these indexes with identical fields.
  range: (q: any) => any,
): Promise<DocumentMetadata[]> {
  if (documentMetaReady(site)) return (await ctx.db.query("documentMeta").withIndex(index, range).collect()).map(metadataFromMeta);
  return (await ctx.db.query("documents").withIndex(index, range).collect()).map(documentMetadata);
}

export type MetadataPage = { page: DocumentMetadata[]; isDone: boolean; continueCursor: string };

/** One page of an index range from a specific source. Cursors are native to
 * that source; callers wrap them (see `paginateDocumentMetadata`). */
export async function paginateMetadataSource(
  ctx: QueryCtx,
  source: MetadataSource,
  index: MetadataIndex,
  range: (q: any) => any,
  options: { cursor: string | null; numItems: number; maximumBytesRead?: number },
): Promise<MetadataPage> {
  if (source === "documentMeta") {
    const result = await ctx.db.query("documentMeta").withIndex(index, range).paginate(options);
    return { page: result.page.map(metadataFromMeta), isDone: result.isDone, continueCursor: result.continueCursor };
  }
  const result = await ctx.db.query("documents").withIndex(index, range).paginate(options);
  return { page: result.page.map(documentMetadata), isDone: result.isDone, continueCursor: result.continueCursor };
}

export const DOCUMENT_META_CURSOR_PREFIX = "docmeta1:";

/** Pick the source for a paginated read: a continuation keeps the source it
 * started on; a fresh read follows the site's flag. */
export function metadataSourceForCursor(site: SiteCtx, cursor: string | null): { source: MetadataSource; cursor: string | null } {
  if (cursor === null) return { source: documentMetaReady(site) ? "documentMeta" : "documents", cursor: null };
  if (cursor.startsWith(DOCUMENT_META_CURSOR_PREFIX)) return { source: "documentMeta", cursor: cursor.slice(DOCUMENT_META_CURSOR_PREFIX.length) };
  return { source: "documents", cursor };
}

/** Paginate with opaque cursors: legacy (documents) cursors stay raw so
 * in-flight paginations from before the deploy keep working; meta cursors
 * carry a prefix. */
export async function paginateDocumentMetadata(
  ctx: QueryCtx,
  site: ScopedSite,
  index: MetadataIndex,
  range: (q: any) => any,
  options: { cursor: string | null; numItems: number; maximumBytesRead?: number },
): Promise<MetadataPage> {
  const { source, cursor } = metadataSourceForCursor(site, options.cursor);
  const result = await paginateMetadataSource(ctx, source, index, range, { ...options, cursor });
  return source === "documentMeta"
    ? { ...result, continueCursor: DOCUMENT_META_CURSOR_PREFIX + result.continueCursor }
    : result;
}

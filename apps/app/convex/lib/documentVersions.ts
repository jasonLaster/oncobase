/**
 * Page history.
 *
 * `documents` holds only the live version of a page, so every publish that
 * changes a page's body or title first archives the outgoing version here, in
 * the same transaction (see `documents.upsert`). The vault's git history can
 * also be imported for versions that predate this table (`importVersions`).
 *
 * What is stored is the reader-facing body: `documents.content`, already
 * PII-redacted at publish time. Unredacted `rawContent` is never copied.
 *
 * Visibility rule: a reader sees a page's history only if they can read the
 * live page, and a version that was restricted (`sensitive`) is listed only
 * while the live page is restricted too. Restricted reads also apply the
 * reader's current grants to each version's own access metadata.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const MAX_LISTED_VERSIONS = 200;
// Allow room for the document's fields and Convex metadata under its 1 MiB limit.
const MAX_VERSION_CONTENT_BYTES = 1024 * 1024 - 1024;

export function versionBodyHash(title: string, content: string) {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify({ title, content })))).slice(0, 32);
}

/** Whether a reader of `live` may see `version` (see the module comment). */
export function versionVisibleWith(live: { sensitive?: boolean }, version: { sensitive: boolean }) {
  return !version.sensitive || live.sensitive === true;
}

type VersionInput = {
  title: string;
  content: string;
  tags: string[];
  sensitive: boolean;
  sensitiveInclude?: string[];
  versionAt: number;
  source: "publish" | "git";
  commitSha?: string;
  commitMessage?: string;
};

async function insertVersion(ctx: MutationCtx, doc: Doc<"documents"> & { siteId: Id<"sites"> }, input: VersionInput, bodyHash: string) {
  const bodyId = await ctx.db.insert("documentVersionBodies", { siteId: doc.siteId, content: input.content });
  return ctx.db.insert("documentVersions", {
    siteId: doc.siteId,
    documentId: doc._id,
    slug: doc.slug,
    title: input.title,
    tags: input.tags,
    sensitive: input.sensitive,
    sensitiveInclude: input.sensitiveInclude,
    bodyHash,
    size: input.content.length,
    versionAt: input.versionAt,
    source: input.source,
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    ...(input.commitMessage ? { commitMessage: input.commitMessage.slice(0, 500) } : {}),
    bodyId,
    createdAt: Date.now(),
  });
}

/**
 * Archive `existing` before a publish overwrites it. No-op when the body and
 * title are unchanged (metadata-only publishes), when the row was deleted or
 * has no site, or when the newest stored version already holds this body.
 */
export async function archiveBeforeOverwrite(
  ctx: MutationCtx,
  existing: Doc<"documents">,
  next: { title: string; content: string },
) {
  if (!existing.siteId || existing.deletedAt) return null;
  if (existing.title === next.title && existing.content === next.content) return null;
  const bodyHash = versionBodyHash(existing.title, existing.content);
  // eslint-disable-next-line no-restricted-syntax -- Callers resolved the site and its document; the index is scoped by siteId.
  const latest = await ctx.db
    .query("documentVersions")
    .withIndex("by_site_document_time", q => q.eq("siteId", existing.siteId!).eq("documentId", existing._id))
    .order("desc")
    .first();
  if (latest?.bodyHash === bodyHash) return null;
  return insertVersion(ctx, existing as Doc<"documents"> & { siteId: Id<"sites"> }, {
    title: existing.title,
    content: existing.content,
    tags: existing.tags,
    sensitive: existing.sensitive === true,
    sensitiveInclude: existing.sensitiveInclude,
    versionAt: existing.updatedAt,
    source: "publish",
  }, bodyHash);
}

/**
 * Import past versions, in any order. Skips a version whose
 * body matches the live page or any stored version, so re-running an import
 * is idempotent and consecutive commits that only touched frontmatter collapse.
 */
export async function importVersions(ctx: MutationCtx, doc: Doc<"documents">, versions: VersionInput[]) {
  if (!doc.siteId || doc.deletedAt) return { inserted: 0, skipped: versions.length };
  const liveHash = versionBodyHash(doc.title, doc.content);
  const seen = new Set<string>([liveHash]);
  let inserted = 0;
  let skipped = 0;
  let oversized = 0;
  for (const version of [...versions].sort((a, b) => a.versionAt - b.versionAt)) {
    if (new TextEncoder().encode(version.content).byteLength > MAX_VERSION_CONTENT_BYTES) {
      oversized++;
      continue;
    }
    const bodyHash = versionBodyHash(version.title, version.content);
    if (seen.has(bodyHash)) { skipped++; continue; }
    seen.add(bodyHash);
    // eslint-disable-next-line no-restricted-syntax -- Callers resolved the site and its document; the index is scoped by siteId.
    const stored = await ctx.db
      .query("documentVersions")
      .withIndex("by_site_document_body", q => q.eq("siteId", doc.siteId!).eq("documentId", doc._id).eq("bodyHash", bodyHash))
      .first();
    if (stored) { skipped++; continue; }
    await insertVersion(ctx, doc as Doc<"documents"> & { siteId: Id<"sites"> }, version, bodyHash);
    inserted++;
  }
  return { inserted, skipped, ...(oversized ? { oversized } : {}) };
}

export async function listVisibleVersions(ctx: QueryCtx, live: Doc<"documents"> & { siteId: Id<"sites"> }) {
  // eslint-disable-next-line no-restricted-syntax -- Callers resolved the site and its document; the index is scoped by siteId.
  const rows = await ctx.db
    .query("documentVersions")
    .withIndex("by_site_document_time", q => q.eq("siteId", live.siteId).eq("documentId", live._id))
    .order("desc")
    .take(MAX_LISTED_VERSIONS);
  return rows.filter(row => row.siteId === live.siteId && versionVisibleWith(live, row));
}

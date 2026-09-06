import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export const SITE_SLUG_RE = /^[a-z0-9-]{1,32}$/;
export const DEFAULT_SITE_SLUG = "diana";

export type SiteCtx = {
  siteId: Id<"sites"> | null;
  siteSlug: string;
  site: Doc<"sites"> | null;
};

export function assertSiteSlug(slug: string): asserts slug is string {
  if (!SITE_SLUG_RE.test(slug)) {
    throw new Error(`invalid siteSlug: ${slug}`);
  }
}

/**
 * Resolve and validate the active site for a Convex call.
 *
 * Returns `siteId: null` only when no row exists for `slug` — every
 * production tenant table now requires a populated `siteId`, so an
 * unresolved site causes downstream filters to match nothing rather
 * than leak across tenants. (See `rowBelongsToSite` below.)
 */
export async function requireSite(
  ctx: QueryCtx | MutationCtx,
  siteSlug: string | undefined,
): Promise<SiteCtx> {
  const slug = siteSlug ?? DEFAULT_SITE_SLUG;
  assertSiteSlug(slug);
  const site = await ctx.db
    .query("sites")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (!site) {
    return { siteId: null, siteSlug: slug, site: null };
  }
  if (site.status !== "active") {
    throw new Error(`site ${slug} is not active`);
  }
  return { siteId: site._id, siteSlug: site.slug, site };
}

/**
 * Strict tenant scope check. Rows must carry an explicit `siteId` that
 * matches the resolved site — the previous Diana-defaults-to-no-siteId
 * fallback is gone now that every tenant row is backfilled.
 */
export function rowBelongsToSite(
  row: { siteId?: Id<"sites"> | null },
  site: SiteCtx,
): boolean {
  if (!row.siteId || !site.siteId) return false;
  return row.siteId === site.siteId;
}

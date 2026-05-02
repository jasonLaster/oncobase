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
 * `siteSlug` is passed explicitly during the migration window. Phase 3
 * threads it from the host-resolved request header on every callsite;
 * once the threading is complete, this helper will read it directly
 * from `ctx.auth.getUserIdentity()` and the slug arg becomes a sanity
 * check.
 *
 * Returns `siteId: null` for legacy rows that pre-date the multi-site
 * backfill — callers must filter results to those with no `siteId` OR
 * whose `siteId` matches the resolved site. The
 * `rowBelongsToSite` helper wraps that check.
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
 * True if the row belongs to the active site, including legacy rows
 * with no siteId during the Diana migration window.
 */
export function rowBelongsToSite(
  row: { siteId?: Id<"sites"> | null },
  site: SiteCtx,
): boolean {
  if (!row.siteId) {
    return site.siteSlug === DEFAULT_SITE_SLUG;
  }
  return row.siteId === site.siteId;
}

/* eslint-disable no-restricted-syntax -- All indexed reads require a resolved siteId. */
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./lib/serviceFunctions";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

const manageArgs = { siteSlug: v.string(), sessionTokenHash: v.string(), slug: v.string() };

// Sharing extends access outside RBAC, so only an owner or explicitly assigned
// Admin can do it. Check the session and role again inside the transaction.
async function requireManager(ctx: QueryCtx, site: SiteCtx, tokenHash: string) {
  if (!site.siteId || !site.site) throw new ConvexError("Forbidden");
  const session = await ctx.db.query("userSessions").withIndex("by_site_token", q =>
    q.eq("siteId", site.siteId!).eq("tokenHash", tokenHash)).first();
  if (!session || session.expiresAt <= Date.now()) throw new ConvexError("Forbidden");
  const user = await ctx.db.get(session.userId);
  if (!user || !rowBelongsToSite(user, site)) throw new ConvexError("Forbidden");
  if (user.email.toLowerCase() === site.site.ownerEmail.toLowerCase()) return user;
  const assignments = await ctx.db.query("userRoles").withIndex("by_site_user", q =>
    q.eq("siteId", site.siteId!).eq("userId", user._id)).collect();
  for (const assignment of assignments) {
    const role = await ctx.db.get(assignment.roleId);
    if (role && rowBelongsToSite(role, site) && role.name.trim().toLowerCase() === "admin") return user;
  }
  throw new ConvexError("Forbidden");
}

async function managedPage(ctx: QueryCtx, args: { siteSlug: string; sessionTokenHash: string; slug: string }) {
  const site = await requireSite(ctx, args.siteSlug);
  const user = await requireManager(ctx, site, args.sessionTokenHash);
  const page = await ctx.db.query("documents").withIndex("by_site_slug", q =>
    q.eq("siteId", site.siteId!).eq("slug", args.slug)).first();
  if (!page || page.deletedAt || page.sensitive !== true) throw new ConvexError("Page unavailable");
  return { site, user, page };
}

export const status = query({
  args: manageArgs,
  handler: async (ctx, args) => {
    const { site, page } = await managedPage(ctx, args);
    const share = await ctx.db.query("pageShares").withIndex("by_site_document", q =>
      q.eq("siteId", site.siteId!).eq("documentId", page._id).eq("revokedAt", undefined)).first();
    return Boolean(share);
  },
});

export const create = mutation({
  args: { ...manageArgs, tokenHash: v.string() },
  handler: async (ctx, args) => {
    const { site, page, user } = await managedPage(ctx, args);
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) throw new ConvexError("Invalid link");
    const now = Date.now();
    const shares = await ctx.db.query("pageShares").withIndex("by_site_document", q =>
      q.eq("siteId", site.siteId!).eq("documentId", page._id).eq("revokedAt", undefined)).collect();
    for (const share of shares) if (!share.revokedAt) await ctx.db.patch(share._id, { revokedAt: now });
    await ctx.db.insert("pageShares", { siteId: site.siteId!, documentId: page._id,
      tokenHash: args.tokenHash, createdBy: user._id, createdAt: now });
    return true;
  },
});

export const revoke = mutation({
  args: manageArgs,
  handler: async (ctx, args) => {
    const { site, page } = await managedPage(ctx, args);
    const shares = await ctx.db.query("pageShares").withIndex("by_site_document", q =>
      q.eq("siteId", site.siteId!).eq("documentId", page._id).eq("revokedAt", undefined)).collect();
    for (const share of shares) if (!share.revokedAt) await ctx.db.patch(share._id, { revokedAt: Date.now() });
    return null;
  },
});

async function sharedPage(ctx: QueryCtx, siteSlug: string, tokenHash: string) {
  const site = await requireSite(ctx, siteSlug);
  if (!site.siteId) return null;
  const share = await ctx.db.query("pageShares").withIndex("by_site_token", q =>
    q.eq("siteId", site.siteId!).eq("tokenHash", tokenHash)).first();
  if (!share || share.revokedAt) return null;
  const page = await ctx.db.get(share.documentId);
  if (!page || !rowBelongsToSite(page, site) || page.deletedAt) return null;
  return { site, page };
}

export const read = query({
  args: { siteSlug: v.string(), tokenHash: v.string() },
  handler: async (ctx, args) => {
    const result = await sharedPage(ctx, args.siteSlug, args.tokenHash);
    if (!result) return null;
    const { page } = result;
    // Explicit projection: never return rawContent, embeddings or storage URLs.
    return { slug: page.slug, title: page.title, content: page.content, tags: page.tags, description: page.description,
      sensitive: page.sensitive, contentHash: page.contentHash };
  },
});

export const asset = query({
  args: { siteSlug: v.string(), tokenHash: v.string(), path: v.string() },
  handler: async (ctx, args) => {
    const result = await sharedPage(ctx, args.siteSlug, args.tokenHash);
    if (!result) return null;
    const { site, page } = result;
    const table = args.path.toLowerCase().endsWith(".pdf") ? "pdfAssets" : "fileAssets";
    const asset = await ctx.db.query(table).withIndex("by_site_path", q =>
      q.eq("siteId", site.siteId!).eq("path", args.path)).first();
    // A multi-owner asset could carry another page's private information.
    if (!asset || asset.deletedAt || !asset.ownerSlugs?.length ||
      !asset.ownerSlugs.every(slug => slug === page.slug)) return null;
    return { blobUrl: asset.blobUrl };
  },
});

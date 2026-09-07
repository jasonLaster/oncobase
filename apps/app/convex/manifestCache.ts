import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSite } from "./lib/site";
import { requirePrefetchSecret } from "./lib/prefetchPriority";
import { MANIFEST_SNAPSHOT_VERSION, queueManifestBuild } from "./lib/manifestRevision";

const serviceArgs = { siteSlug: v.string(), serverSecret: v.string() };

// Admin-only inventory for warming and verifying snapshots. Never return site
// configuration, credentials or document contents in operational output.
export const status = internalQuery({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const sites = siteSlug
      ? [(await requireSite(ctx, siteSlug)).site].filter(site => site !== null)
      // eslint-disable-next-line no-restricted-syntax -- Internal admin inventory intentionally enumerates active sites.
      : (await ctx.db.query("sites").collect()).filter(site => site.status === "active");
    return Promise.all(sites.map(async site => {
      const revision = site.manifestRevision ?? 0;
      const snapshot = site.manifestSnapshot;
      const matches = snapshot?.revision === revision && snapshot.formatVersion === MANIFEST_SNAPSHOT_VERSION;
      return {
        siteSlug: site.slug,
        revision,
        hash: matches ? snapshot.hash : null,
        // Storage URLs stay in the authorized operator process, never its logs.
        url: matches ? await ctx.storage.getUrl(snapshot.storageId) : null,
      };
    }));
  },
});

// Snapshot URLs are service-only. The reader receives the JSON through its
// authenticated application endpoint, never an anonymous storage URL.
export const current = query({
  args: serviceArgs,
  handler: async (ctx, { siteSlug, serverSecret }) => {
    requirePrefetchSecret(serverSecret, process.env.WIKI_PREFETCH_SECRET);
    const { site } = await requireSite(ctx, siteSlug);
    const snapshot = site?.manifestSnapshot;
    if (!snapshot || snapshot.revision !== (site?.manifestRevision ?? 0) || snapshot.formatVersion !== MANIFEST_SNAPSHOT_VERSION) return null;
    const url = await ctx.storage.getUrl(snapshot.storageId);
    return url ? { hash: snapshot.hash, url } : null;
  },
});

export const requestBuild = mutation({
  args: serviceArgs,
  handler: async (ctx, { siteSlug, serverSecret }): Promise<null> => {
    requirePrefetchSecret(serverSecret, process.env.WIKI_PREFETCH_SECRET);
    const { siteId } = await requireSite(ctx, siteSlug);
    if (siteId) await queueManifestBuild(ctx, siteId);
    return null;
  },
});

export const revision = internalQuery({
  args: { siteSlug: v.string() },
  handler: async (ctx, { siteSlug }): Promise<number | null> => {
    const { site } = await requireSite(ctx, siteSlug);
    return site ? site.manifestRevision ?? 0 : null;
  },
});

export const install = internalMutation({
  args: { siteSlug: v.string(), revision: v.number(), hash: v.string(), storageId: v.id("_storage"), formatVersion: v.number() },
  handler: async (ctx, args): Promise<boolean> => {
    const { site, siteId } = await requireSite(ctx, args.siteSlug);
    if (!site || !siteId) { await ctx.storage.delete(args.storageId); return false; }
    if ((site.manifestRevision ?? 0) !== args.revision || args.formatVersion !== MANIFEST_SNAPSHOT_VERSION) {
      await ctx.storage.delete(args.storageId);
      await ctx.db.patch(siteId, { manifestBuildQueuedAt: undefined });
      await queueManifestBuild(ctx, siteId);
      return false;
    }
    await ctx.db.patch(siteId, {
      manifestSnapshot: { revision: args.revision, hash: args.hash, storageId: args.storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION },
      manifestBuildQueuedAt: undefined,
    });
    if (site.manifestSnapshot) await ctx.storage.delete(site.manifestSnapshot.storageId);
    return true;
  },
});

export const failed = internalMutation({
  args: { siteSlug: v.string() },
  handler: async (ctx, { siteSlug }): Promise<null> => {
    const { siteId } = await requireSite(ctx, siteSlug);
    if (siteId) await ctx.db.patch(siteId, { manifestBuildQueuedAt: undefined });
    // Next write/request retries. Crashes are recoverable through the build lease.
    return null;
  },
});

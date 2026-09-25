import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireSite } from "./lib/site";
import { requirePrefetchSecret } from "./lib/prefetchPriority";
import { MANIFEST_SNAPSHOT_VERSION, queueManifestBuild } from "./lib/manifestRevision";

// Generations survive lease release, so a delayed failure cannot erase a successor.
// Legacy jobs only own legacy leases; manual builds can install when no job owns it.
function ownsBuild(site: { manifestBuildGeneration?: number; manifestBuildQueuedAt?: number }, generation?: number) {
  return generation === undefined ? site.manifestBuildGeneration === undefined || site.manifestBuildQueuedAt === undefined : generation === site.manifestBuildGeneration && site.manifestBuildQueuedAt !== undefined;
}

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

// A delta may reuse only the immediately preceding, complete public snapshot.
export const deltaBase = internalQuery({
  args: { siteSlug: v.string(), baseRevision: v.number() },
  handler: async (ctx, { siteSlug, baseRevision }) => {
    const { site } = await requireSite(ctx, siteSlug);
    const snapshot = site?.manifestSnapshot;
    if (!snapshot || site?.manifestRevision !== baseRevision + 1 || snapshot.revision !== baseRevision || snapshot.formatVersion !== MANIFEST_SNAPSHOT_VERSION) return null;
    return { storageId: snapshot.storageId, hash: snapshot.hash };
  },
});

export const install = internalMutation({
  args: { siteSlug: v.string(), revision: v.number(), hash: v.string(), storageId: v.id("_storage"), formatVersion: v.number(), generation: v.optional(v.number()) },
  handler: async (ctx, args): Promise<"installed" | "missing-site" | "active-writer" | "stale-revision"> => {
    const { site, siteId } = await requireSite(ctx, args.siteSlug);
    if (!site || !siteId) { await ctx.storage.delete(args.storageId); return "missing-site"; }
    if (!ownsBuild(site, args.generation)) {
      await ctx.storage.delete(args.storageId);
      return "stale-revision";
    }
    // Never install a projection assembled across an active writer's mutations.
    // Finish/abort/expiry will invalidate and schedule after ownership ends.
    if (site.publishRunId?.startsWith("scoped:") && (site.publishLockUntil ?? 0) > Date.now()) {
      await ctx.storage.delete(args.storageId);
      await ctx.db.patch(siteId, { manifestBuildQueuedAt: undefined });
      return "active-writer";
    }
    if ((site.manifestRevision ?? 0) !== args.revision || args.formatVersion !== MANIFEST_SNAPSHOT_VERSION) {
      await ctx.storage.delete(args.storageId);
      await ctx.db.patch(siteId, { manifestBuildQueuedAt: undefined });
      await queueManifestBuild(ctx, siteId);
      return "stale-revision";
    }
    await ctx.db.patch(siteId, {
      manifestSnapshot: { revision: args.revision, hash: args.hash, storageId: args.storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION },
      manifestBuildQueuedAt: undefined,
    });
    if (site.manifestSnapshot) await ctx.storage.delete(site.manifestSnapshot.storageId);
    return "installed";
  },
});

export const failed = internalMutation({
  args: { siteSlug: v.string(), generation: v.optional(v.number()), attempt: v.optional(v.number()), clientTraceId: v.optional(v.string()), delta: v.optional(v.object({ baseRevision: v.number(), slugs: v.array(v.string()) })) },
  handler: async (ctx, { siteSlug, generation, attempt = 0, clientTraceId, delta }): Promise<null> => {
    const { site, siteId } = await requireSite(ctx, siteSlug);
    if (!site || !siteId || !ownsBuild(site, generation)) return null;
    await ctx.db.patch(siteId, { manifestBuildQueuedAt: undefined });
    // Two durable retries for transient read/storage failures. Bounded backoff
    // prevents an unavailable dependency from creating an unbounded job loop.
    // A live writer's finish owns scheduling after its mutations are complete.
    if (attempt < 2 && !(site.publishRunId?.startsWith("scoped:") && (site.publishLockUntil ?? 0) > Date.now())) {
      await queueManifestBuild(ctx, siteId, attempt === 0 ? 250 : 1000, delta, clientTraceId, attempt + 1);
    }
    return null;
  },
});

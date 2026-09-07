import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export const MANIFEST_SNAPSHOT_VERSION = 1;
const BUILD_LEASE_MS = 120_000;

export async function queueManifestBuild(ctx: MutationCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId);
  if (!site || site.status !== "active") return;
  if (site.manifestBuildQueuedAt && Date.now() - site.manifestBuildQueuedAt < BUILD_LEASE_MS) return;
  await ctx.db.patch(siteId, { manifestBuildQueuedAt: Date.now() });
  await ctx.scheduler.runAfter(1000, internal.manifestBuilder.build, { siteSlug: site.slug });
}

// Called in the same transaction as every manifest-affecting write. This also
// invalidates a previously installed snapshot immediately, before rebuilding.
export async function invalidateManifest(ctx: MutationCtx, siteId: Id<"sites"> | null) {
  if (!siteId) return;
  const site = await ctx.db.get(siteId);
  if (!site) return;
  await ctx.db.patch(siteId, { manifestRevision: (site.manifestRevision ?? 0) + 1 });
  await queueManifestBuild(ctx, siteId);
}

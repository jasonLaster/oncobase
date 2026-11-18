import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

// 2: assets carry content hashes and include image files (P11). A bump makes
// every installed snapshot stale; readers then request a rebuild.
export const MANIFEST_SNAPSHOT_VERSION = 2;
const BUILD_LEASE_MS = 120_000;
export type ManifestDelta = { baseRevision: number; slugs: string[] };

/** A scoped publisher's live lease. Builds assembled under it are discarded at
 * install, and its finish/fail/expiry path owns queueing the next build. */
export function hasActiveScopedWriter(site: { publishRunId?: string; publishLockUntil?: number }, now = Date.now()) {
  return Boolean(site.publishRunId?.startsWith("scoped:")) && (site.publishLockUntil ?? 0) > now;
}

export async function queueManifestBuild(ctx: MutationCtx, siteId: Id<"sites">, delayMs = 1000, delta?: ManifestDelta, clientTraceId?: string, attempt = 0) {
  const site = await ctx.db.get(siteId);
  if (!site || site.status !== "active") return;
  if (site.manifestBuildQueuedAt && Date.now() - site.manifestBuildQueuedAt < BUILD_LEASE_MS) return;
  const queuedAt = Date.now();
  const generation = (site.manifestBuildGeneration ?? 0) + 1;
  await ctx.db.patch(siteId, { manifestBuildQueuedAt: queuedAt, manifestBuildGeneration: generation });
  // Deltas run in the default runtime; they hand off to the Node full builder
  // themselves when the snapshot cannot be patched.
  await ctx.scheduler.runAfter(delayMs, delta ? internal.manifestDeltaBuilder.build : internal.manifestBuilder.build, { siteSlug: site.slug, queuedAt, generation, attempt, ...(clientTraceId ? { clientTraceId } : {}), ...(delta ? { delta } : {}) });
}

// Called in the same transaction as every manifest-affecting write. This also
// invalidates a previously installed snapshot immediately, before rebuilding.
export async function invalidateManifest(ctx: MutationCtx, siteId: Id<"sites"> | null, delayMs = 1000, delta?: ManifestDelta, clientTraceId?: string) {
  if (!siteId) return;
  const site = await ctx.db.get(siteId);
  if (!site) return;
  await ctx.db.patch(siteId, { manifestRevision: (site.manifestRevision ?? 0) + 1 });
  await queueManifestBuild(ctx, siteId, delayMs, delta, clientTraceId);
}

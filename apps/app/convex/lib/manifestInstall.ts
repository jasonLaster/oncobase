// Runtime-neutral: shared by the default-runtime delta builder and the Node
// full builder, so it must not import Node built-ins.
import { v } from "convex/values";
import type { ManifestTelemetry } from "../../shared/manifest-telemetry";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { MANIFEST_SNAPSHOT_VERSION, type ManifestDelta } from "./manifestRevision";

export const manifestBuildArgs = { siteSlug: v.string(), queuedAt: v.optional(v.number()), generation: v.optional(v.number()), attempt: v.optional(v.number()), clientTraceId: v.optional(v.string()), delta: v.optional(v.object({ baseRevision: v.number(), slugs: v.array(v.string()) })) };
export type ManifestBuildArgs = { siteSlug: string; queuedAt?: number; generation?: number; attempt?: number; clientTraceId?: string; delta?: ManifestDelta };
type Phases = Record<string, number>;

/** Store the snapshot bytes and hand them to `install`, which owns the
 * revision/generation/active-writer fences. A failure deletes the orphaned
 * blob and reaches `failed`, which owns bounded retries. */
export async function storeAndInstall(ctx: ActionCtx, args: ManifestBuildArgs, revision: number, json: string, phases: Phases, event: Pick<ManifestTelemetry, "outcome" | "failureStage">) {
  let storageId: Id<"_storage"> | undefined;
  try {
    const hash = (JSON.parse(json) as { manifestHash: string }).manifestHash;
    event.failureStage = "store";
    const storeStarted = performance.now();
    storageId = await ctx.storage.store(new Blob([json], { type: "application/json" }));
    phases.store = Math.round(performance.now() - storeStarted);
    event.failureStage = "install";
    const installStarted = performance.now();
    event.outcome = await ctx.runMutation(internal.manifestCache.install, { siteSlug: args.siteSlug, revision, hash, storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION, generation: args.generation });
    phases.install = Math.round(performance.now() - installStarted);
    event.failureStage = "none";
  } catch {
    event.outcome = "failed";
    if (storageId) {
      try { await ctx.storage.delete(storageId); } catch { console.warn("Manifest orphan cleanup deferred"); }
    }
    await recordManifestFailure(ctx, args);
  }
}

export async function recordManifestFailure(ctx: ActionCtx, { siteSlug, generation, attempt = 0, clientTraceId, delta }: ManifestBuildArgs) {
  await ctx.runMutation(internal.manifestCache.failed, { siteSlug, generation, attempt, clientTraceId, delta });
  console.warn("Manifest snapshot build deferred");
}

/** Log and export one build event. A broken relay must never change the
 * publish result. No storage URLs, slugs, credentials or error bodies. */
export async function emitManifestTelemetry(event: ManifestTelemetry) {
  console.info("publish.manifest", JSON.stringify({ ...event, succeeded: event.outcome === "installed" }));
  const origin = process.env.WIKI_TELEMETRY_ORIGIN;
  const secret = process.env.WIKI_PREFETCH_SECRET;
  if (!origin || !secret) return;
  try {
    const response = await fetch(new URL("/api/telemetry/manifest", origin), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(event), signal: AbortSignal.timeout(2000), redirect: "error" });
    if (!response.ok) console.warn("manifest.telemetry.rejected", response.status);
  } catch { console.warn("manifest.telemetry.unavailable"); }
}

// Default (V8) runtime on purpose. Publish readiness waits on this build, and
// a "use node" action paid a cold start on nearly every publish (~0.5s for the
// first query, 2-3s of I/O for a patch that costs ~10ms of CPU). Anything that
// cannot be patched hands off to the Node full builder.
import type { WikiManifestPage } from "@oncobase/wiki-content";
import type { ManifestTelemetry } from "../shared/manifest-telemetry";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { patchManifestPages, type ManifestAssetUpdate } from "./lib/manifestDelta";
import { MANIFEST_DELTA_LIMIT } from "./lib/manifestRevision";
import { emitManifestTelemetry, manifestBuildArgs, recordManifestFailure, storeAndInstall } from "./lib/manifestInstall";

type FallbackReason = "full-required" | "base-unavailable" | "unsupported-pages" | "delta-failed";

export const build = internalAction({
  args: manifestBuildArgs,
  handler: async (ctx, args): Promise<null> => {
    const { siteSlug, delta, queuedAt, clientTraceId, generation, attempt = 0 } = args;
    const started = performance.now(), startedAt = Date.now();
    const phases: Record<string, number> = {};
    const event: ManifestTelemetry = { version: 1, startedAt, queuedAt, attempt, clientTraceId, revision: -1, durationMs: 0, incremental: true, strategyReason: "delta",
      ...(delta ? { changedDocuments: delta.slugs.length } : {}), ...(delta?.assets ? { changedAssets: delta.assets.length } : {}), outcome: "failed", failureStage: "revision", phases };
    let fallback: FallbackReason | undefined, handedOff = false;
    try {
      const revision = await ctx.runQuery(internal.manifestCache.revision, { siteSlug });
      phases.revision = Math.round(performance.now() - started);
      if (revision === null) { event.outcome = "missing-site"; event.failureStage = "none"; return null; }
      event.revision = revision;
      event.failureStage = "assemble";
      let json: string | null = null;
      const assetKeys = delta?.assets ?? [];
      if (!delta || delta.slugs.length > MANIFEST_DELTA_LIMIT || assetKeys.length > MANIFEST_DELTA_LIMIT || revision !== delta.baseRevision + 1) fallback = "full-required";
      else {
        const deltaStarted = performance.now();
        try {
          const base = await ctx.runQuery(internal.manifestCache.deltaBase, { siteSlug, baseRevision: delta.baseRevision });
          const pages: Array<WikiManifestPage | null> = [];
          const assets: ManifestAssetUpdate[] = [];
          let bytes: Blob | null = null;
          if (base) {
            // Fetch the base bytes while the changed rows are read. Bound
            // database pressure: each indexed batch may read 16 maximum-size rows.
            const batches = [];
            for (let offset = 0; offset < delta.slugs.length; offset += 16) {
              batches.push(ctx.runQuery(internal.documents.internal_publisherManifestPages, { siteSlug, slugs: delta.slugs.slice(offset, offset + 16) }));
            }
            const [blob, rows, changedAssets] = await Promise.all([ctx.storage.get(base.storageId), Promise.all(batches),
              assetKeys.length ? ctx.runQuery(internal.documents.internal_publisherManifestAssets, { siteSlug, keys: assetKeys }) : []]);
            bytes = blob;
            for (const batch of rows) pages.push(...batch);
            assets.push(...changedAssets);
          }
          if (!base || !bytes) fallback = "base-unavailable";
          else {
            json = patchManifestPages(JSON.parse(await bytes.text()), siteSlug, base.hash, pages, assets);
            if (json === null) fallback = "unsupported-pages";
          }
        } catch { fallback = "delta-failed"; }
        phases.deltaRead = Math.round(performance.now() - deltaStarted);
      }
      if (json === null) {
        const reason = fallback ?? "delta-failed";
        event.incremental = false;
        event.strategyReason = reason;
        // Same build ownership (generation and queue lease); the Node builder
        // records the final event, including why the delta did not apply.
        await ctx.scheduler.runAfter(0, internal.manifestBuilder.build, { siteSlug, queuedAt, generation, attempt, clientTraceId,
          fallback: { reason, ...(phases.deltaRead !== undefined ? { deltaReadMs: phases.deltaRead } : {}) } });
        handedOff = true;
        return null;
      }
      await storeAndInstall(ctx, args, revision, json, phases, event);
    } catch {
      event.outcome = "failed";
      await recordManifestFailure(ctx, args);
    } finally {
      if (!handedOff) {
        event.durationMs = Math.round(performance.now() - started);
        await emitManifestTelemetry(event);
      }
    }
    return null;
  },
});

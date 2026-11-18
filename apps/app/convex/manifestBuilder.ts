"use node";
import { v } from "convex/values";
import { createWikiManifestResponse, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import type { ManifestTelemetry } from "../shared/manifest-telemetry";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { emitManifestTelemetry, manifestBuildArgs, recordManifestFailure, storeAndInstall } from "./lib/manifestInstall";

/** Full rebuild. Publish deltas run in `manifestDeltaBuilder` (default
 * runtime) and land here only when they cannot be patched; `fallback` says
 * why. `delta` stays in the validator for jobs scheduled before that split and
 * is otherwise ignored: a full build is always correct. */
export const build = internalAction({
  args: { ...manifestBuildArgs, fallback: v.optional(v.object({
    reason: v.union(v.literal("full-required"), v.literal("base-unavailable"), v.literal("unsupported-pages"), v.literal("delta-failed")),
    deltaReadMs: v.optional(v.number()),
  })) },
  handler: async (ctx, { fallback, ...args }): Promise<null> => {
    const { siteSlug, delta, queuedAt, clientTraceId, attempt = 0 } = args;
    const started = performance.now(), startedAt = Date.now();
    const phases: Record<string, number> = fallback?.deltaReadMs !== undefined ? { deltaRead: fallback.deltaReadMs } : {};
    const event: ManifestTelemetry = { version: 1, startedAt, queuedAt, attempt, clientTraceId, revision: -1, durationMs: 0, incremental: false,
      strategyReason: fallback?.reason ?? "full-required", ...(delta ? { changedDocuments: delta.slugs.length } : {}), outcome: "failed", failureStage: "revision", phases };
    try {
      const revision = await ctx.runQuery(internal.manifestCache.revision, { siteSlug });
      phases.revision = Math.round(performance.now() - started);
      if (revision === null) { event.outcome = "missing-site"; event.failureStage = "none"; return null; }
      event.revision = revision;
      event.failureStage = "assemble";
      const documents: WikiApiDocumentsGateway = {
        listManifestPage: args => ctx.runQuery(internal.documents.internal_listManifestPage, { ...args, siteSlug }),
        listPageWithContent: args => ctx.runQuery(internal.documents.internal_listPageWithContent, { ...args, siteSlug }),
        listPdfAssetPathsPage: args => ctx.runQuery(internal.documents.internal_listPdfAssetPathsPage, { ...args, siteSlug }),
        listFileAssetPathsPage: args => ctx.runQuery(internal.documents.internal_listFileAssetPathsPage, { ...args, siteSlug }),
        listPdfAssetVisibilityPage: args => ctx.runQuery(internal.documents.internal_listPdfAssetVisibilityPage, { ...args, siteSlug }),
        listFileAssetVisibilityPage: args => ctx.runQuery(internal.documents.internal_listFileAssetVisibilityPage, { ...args, siteSlug }),
        getBySlug: args => ctx.runQuery(internal.documents.internal_getBySlug, { ...args, siteSlug }),
      };
      const response = await createWikiManifestResponse(new Request("https://manifest.internal/api/wiki/manifest?scope=public"), { siteSlug, documents, manifestFileAssets: true, getSessionUser: async () => null, onManifestPhase: (name, ms) => { phases[name] = Math.round(ms); } });
      if (!response.ok || response.headers.get("X-Wiki-Manifest-Partial") === "true" || response.headers.get("X-Wiki-Manifest-Source") !== "manifest") throw new Error("Incomplete manifest");
      await storeAndInstall(ctx, args, revision, await response.text(), phases, event);
    } catch {
      event.outcome = "failed";
      // Retries of a fallback stay full builds; a legacy delta job retries as a delta.
      await recordManifestFailure(ctx, args);
    } finally {
      event.durationMs = Math.round(performance.now() - started);
      await emitManifestTelemetry(event);
    }
    return null;
  },
});

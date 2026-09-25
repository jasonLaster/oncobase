"use node";
import type { ManifestTelemetry } from "../shared/manifest-telemetry";
import { patchManifestPages } from "./lib/manifestDelta";
import type { WikiManifestPage } from "@oncobase/wiki-content";
import { v } from "convex/values";
import { createWikiManifestResponse, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { internal } from "./_generated/api";
import { MANIFEST_SNAPSHOT_VERSION } from "./lib/manifestRevision";
import { internalAction } from "./_generated/server";

export const build = internalAction({
  args: { siteSlug: v.string(), queuedAt: v.optional(v.number()), generation: v.optional(v.number()), attempt: v.optional(v.number()), clientTraceId: v.optional(v.string()), delta: v.optional(v.object({ baseRevision: v.number(), slugs: v.array(v.string()) })) },
  handler: async (ctx, { siteSlug, delta, queuedAt, clientTraceId, generation, attempt = 0 }): Promise<null> => {
    const started = performance.now(), startedAt = Date.now();
    let revision = -1;
    let outcome: ManifestTelemetry["outcome"] = "failed";
    let failureStage: ManifestTelemetry["failureStage"] = "revision";
    const phases: Record<string, number> = {};
    let succeeded = false, incremental = false;
    let storageId: import("./_generated/dataModel").Id<"_storage"> | undefined;
    try {
      const currentRevision = await ctx.runQuery(internal.manifestCache.revision, { siteSlug });
      phases.revision = Math.round(performance.now() - started);
      if (currentRevision === null) { outcome = "missing-site"; return null; }
      revision = currentRevision;
      failureStage = "assemble";
      const documents: WikiApiDocumentsGateway = {
        listManifestPage: args => ctx.runQuery(internal.documents.internal_listManifestPage, { ...args, siteSlug }),
        listPageWithContent: args => ctx.runQuery(internal.documents.internal_listPageWithContent, { ...args, siteSlug }),
        listPdfAssetPathsPage: args => ctx.runQuery(internal.documents.internal_listPdfAssetPathsPage, { ...args, siteSlug }),
        listFileAssetPathsPage: args => ctx.runQuery(internal.documents.internal_listFileAssetPathsPage, { ...args, siteSlug }),
        listPdfAssetVisibilityPage: args => ctx.runQuery(internal.documents.internal_listPdfAssetVisibilityPage, { ...args, siteSlug }),
        listFileAssetVisibilityPage: args => ctx.runQuery(internal.documents.internal_listFileAssetVisibilityPage, { ...args, siteSlug }),
        getBySlug: args => ctx.runQuery(internal.documents.internal_getBySlug, { ...args, siteSlug }),
      };
      let json: string | null = null;
      if (delta && delta.slugs.length <= 128 && revision === delta.baseRevision + 1) {
        const deltaStarted = performance.now();
        try {
          const base = await ctx.runQuery(internal.manifestCache.deltaBase, { siteSlug, baseRevision: delta.baseRevision });
          if (base) {
            const blob = await ctx.storage.get(base.storageId);
            if (blob) {
              const pages: Array<WikiManifestPage | null> = [];
              // Bound database pressure: each indexed batch may read 16 maximum-size rows.
              for (let offset = 0; offset < delta.slugs.length; offset += 16) {
                pages.push(...await ctx.runQuery(internal.documents.internal_publisherManifestPages, { siteSlug, slugs: delta.slugs.slice(offset, offset + 16) }));
              }
              json = patchManifestPages(JSON.parse(await blob.text()), siteSlug, base.hash, pages);
              incremental = json !== null;
            }
          }
        } catch { /* Missing/corrupt bases and unsupported changes use the full builder. */ }
        phases.deltaRead = Math.round(performance.now() - deltaStarted);
      }
      if (json === null) {
        const response = await createWikiManifestResponse(new Request("https://manifest.internal/api/wiki/manifest?scope=public"), { siteSlug, documents, getSessionUser: async () => null, onManifestPhase: (name, ms) => { phases[name] = Math.round(ms); } });
        if (!response.ok || response.headers.get("X-Wiki-Manifest-Partial") === "true" || response.headers.get("X-Wiki-Manifest-Source") !== "manifest") throw new Error("Incomplete manifest");
        json = await response.text();
      }
      const hash = (JSON.parse(json) as { manifestHash: string }).manifestHash;
      failureStage = "store";
      const storeStarted = performance.now();
      storageId = await ctx.storage.store(new Blob([json], { type: "application/json" }));
      phases.store = Math.round(performance.now() - storeStarted);
      failureStage = "install";
      const installStarted = performance.now();
      const installed = await ctx.runMutation(internal.manifestCache.install, { siteSlug, revision, hash, storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION, generation });
      phases.install = Math.round(performance.now() - installStarted);
      outcome = installed;
      succeeded = installed === "installed";
      failureStage = "none";
      storageId = undefined;
    } catch {
      if (storageId) {
        try { await ctx.storage.delete(storageId); } catch { console.warn("Manifest orphan cleanup deferred"); }
      }
      await ctx.runMutation(internal.manifestCache.failed, { siteSlug, generation, attempt, clientTraceId, delta });
      console.warn("Manifest snapshot build deferred");
    } finally {
      const event: ManifestTelemetry = { version: 1, startedAt, queuedAt, attempt, clientTraceId, revision, durationMs: Math.round(performance.now() - started), incremental, outcome, failureStage, phases };
      console.info("publish.manifest", JSON.stringify({ ...event, succeeded }));
      // Export after install/failure handling. A broken relay must never change
      // the publish result. No storage URLs, slugs, credentials or error bodies.
      const origin = process.env.WIKI_TELEMETRY_ORIGIN;
      const secret = process.env.WIKI_PREFETCH_SECRET;
      if (origin && secret) {
        try {
          const response = await fetch(new URL("/api/telemetry/manifest", origin), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(event), signal: AbortSignal.timeout(2000), redirect: "error" });
          if (!response.ok) console.warn("manifest.telemetry.rejected", response.status);
        } catch { console.warn("manifest.telemetry.unavailable"); }
      }
    }
    return null;
  },
});

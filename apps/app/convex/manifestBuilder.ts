"use node";
import { patchManifestPages } from "./lib/manifestDelta";
import type { WikiManifestPage } from "@oncobase/wiki-content";
import { v } from "convex/values";
import { createWikiManifestResponse, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { internal } from "./_generated/api";
import { MANIFEST_SNAPSHOT_VERSION } from "./lib/manifestRevision";
import { internalAction } from "./_generated/server";

export const build = internalAction({
  args: { siteSlug: v.string(), delta: v.optional(v.object({ baseRevision: v.number(), slugs: v.array(v.string()) })) },
  handler: async (ctx, { siteSlug, delta }): Promise<null> => {
    const started = performance.now();
    const phases: Record<string, number> = {};
    let succeeded = false, incremental = false;
    let storageId: import("./_generated/dataModel").Id<"_storage"> | undefined;
    try {
      const revision = await ctx.runQuery(internal.manifestCache.revision, { siteSlug });
      if (revision === null) return null;
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
      const storeStarted = performance.now();
      storageId = await ctx.storage.store(new Blob([json], { type: "application/json" }));
      phases.store = Math.round(performance.now() - storeStarted);
      const installStarted = performance.now();
      const installed = await ctx.runMutation(internal.manifestCache.install, { siteSlug, revision, hash, storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION });
      phases.install = Math.round(performance.now() - installStarted);
      succeeded = installed;
      storageId = undefined;
    } catch {
      if (storageId) await ctx.storage.delete(storageId);
      await ctx.runMutation(internal.manifestCache.failed, { siteSlug });
      console.warn("Manifest snapshot build deferred");
    } finally {
      console.info("publish.manifest", JSON.stringify({ durationMs: Math.round(performance.now() - started), succeeded, incremental, phases }));
    }
    return null;
  },
});

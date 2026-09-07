"use node";
import { v } from "convex/values";
import { createWikiManifestResponse, type WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { api, internal } from "./_generated/api";
import { MANIFEST_SNAPSHOT_VERSION } from "./lib/manifestRevision";
import { internalAction } from "./_generated/server";

export const build = internalAction({
  args: { siteSlug: v.string() },
  handler: async (ctx, { siteSlug }): Promise<null> => {
    let storageId: import("./_generated/dataModel").Id<"_storage"> | undefined;
    try {
      const revision = await ctx.runQuery(internal.manifestCache.revision, { siteSlug });
      if (revision === null) return null;
      const documents: WikiApiDocumentsGateway = {
        listManifestPage: args => ctx.runQuery(api.documents.listManifestPage, { ...args, siteSlug }),
        listPageWithContent: args => ctx.runQuery(api.documents.listPageWithContent, { ...args, siteSlug }),
        listPdfAssetPathsPage: args => ctx.runQuery(api.documents.listPdfAssetPathsPage, { ...args, siteSlug }),
        listFileAssetPathsPage: args => ctx.runQuery(api.documents.listFileAssetPathsPage, { ...args, siteSlug }),
        listPdfAssetVisibilityPage: args => ctx.runQuery(api.documents.listPdfAssetVisibilityPage, { ...args, siteSlug }),
        listFileAssetVisibilityPage: args => ctx.runQuery(api.documents.listFileAssetVisibilityPage, { ...args, siteSlug }),
        getBySlug: args => ctx.runQuery(api.documents.getBySlug, { ...args, siteSlug }),
      };
      const response = await createWikiManifestResponse(new Request("https://manifest.internal/api/wiki/manifest?scope=public"), { siteSlug, documents, getSessionUser: async () => null });
      if (!response.ok || response.headers.get("X-Wiki-Manifest-Partial") === "true" || response.headers.get("X-Wiki-Manifest-Source") !== "manifest") throw new Error("Incomplete manifest");
      const json = await response.text();
      const hash = (JSON.parse(json) as { manifestHash: string }).manifestHash;
      storageId = await ctx.storage.store(new Blob([json], { type: "application/json" }));
      await ctx.runMutation(internal.manifestCache.install, { siteSlug, revision, hash, storageId, formatVersion: MANIFEST_SNAPSHOT_VERSION });
      storageId = undefined;
    } catch {
      if (storageId) await ctx.storage.delete(storageId);
      await ctx.runMutation(internal.manifestCache.failed, { siteSlug });
      console.warn("Manifest snapshot build deferred");
    }
    return null;
  },
});

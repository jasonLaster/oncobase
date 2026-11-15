import type { ConvexHttpClient } from "convex/browser";
import type { WikiApiAccessAdapter, WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { loadAllowedSensitivePages } from "../allowed-sensitive-slugs";
import { type SessionUser, redactPageContent, withSiteSlug } from "../reader-access";
import { fetchAccessibleSlugs, fetchSlugSensitivity } from "../slug-batch";

export type PageDownloadResult = {
  page: Array<{
    slug: string;
    title: string;
    content: string;
    sensitive?: boolean;
  }>;
  isDone: boolean;
  continueCursor: string | null;
};

export function createDocumentsGateway(
  client: ConvexHttpClient,
  siteSlug: string,
): WikiApiDocumentsGateway {
  return {
    listManifestPage: (args) =>
      client.query(api.documents.listManifestPage, withSiteSlug(siteSlug, args)),
    listPageWithContent: async (args) => {
      const result = await client.query(
        api.documents.listPageWithContent,
        withSiteSlug(siteSlug, args),
      );
      return {
        ...result,
        page: await Promise.all(
          result.page.map((page) => redactPageContent(client, siteSlug, page)),
        ),
      };
    },
    listPdfAssetPathsPage: (args) =>
      client.query(api.documents.listPdfAssetPathsPage, withSiteSlug(siteSlug, args)),
    listFileAssetPathsPage: (args) =>
      client.query(api.documents.listFileAssetPathsPage, withSiteSlug(siteSlug, args)),
    listPdfAssetVisibilityPage: (args) =>
      client.query(
        api.documents.listPdfAssetVisibilityPage,
        withSiteSlug(siteSlug, args),
      ),
    listFileAssetVisibilityPage: (args) =>
      client.query(
        api.documents.listFileAssetVisibilityPage,
        withSiteSlug(siteSlug, args),
      ),
    getBySlug: async (args) => {
      const page = await client.query(api.documents.getBySlug, withSiteSlug(siteSlug, args));
      return page ? redactPageContent(client, siteSlug, page) : null;
    },
  };
}

// Convex may not have these yet (the app can deploy first): remember a missing
// function for a minute and use the older paths meanwhile.
const missingFunctions = new WeakMap<ConvexHttpClient, Map<string, number>>();
async function unlessMissing<T>(client: ConvexHttpClient, name: string, call: () => Promise<T>): Promise<T | null> {
  let missing = missingFunctions.get(client);
  if (!missing) { missing = new Map(); missingFunctions.set(client, missing); }
  if ((missing.get(name) ?? 0) > Date.now()) return null;
  try {
    return await call();
  } catch (error) {
    if (!/Could not find (public )?function/i.test(error instanceof Error ? error.message : String(error))) throw error;
    missing.set(name, Date.now() + 60_000);
    return null;
  }
}

async function readSnapshot(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Manifest snapshot unavailable");
  // Buffer so a broken storage read fails here, before any response starts.
  // Storage URLs never leave the server.
  return await response.arrayBuffer();
}

export function createAccessAdapter(
  client: ConvexHttpClient,
  siteSlug: string,
): WikiApiAccessAdapter {
  return {
    getManifestState: () => unlessMissing(client, "knownState",
      () => client.query(api.manifestCache.knownState, { siteSlug })),
    listSessionManifestOverlay: async (user, { pages, assets, files, numItems, includeSnapshot }) => {
      const result = await unlessMissing(client, "sessionManifestOverlay", () => client.query(api.access.sessionManifestOverlay, withSiteSlug(siteSlug, {
        userId: user._id as Id<"users">, numItems, includeSnapshotUrl: includeSnapshot,
        ...(pages !== undefined ? { pages } : {}), ...(assets !== undefined ? { assets } : {}),
        ...(files !== undefined ? { files } : {}),
      })));
      if (!result) return null;
      const { snapshotUrl, fence, ...rest } = result;
      return {
        ...rest,
        fence,
        snapshot: snapshotUrl && fence.snapshotHash ? { hash: fence.snapshotHash, read: () => readSnapshot(snapshotUrl) } : null,
      };
    },
    canUserAccessSlug: (user, slug) =>
      client.query(
        api.access.canUserAccessSlug,
        withSiteSlug(siteSlug, { userId: user._id as Id<"users">, slug }),
      ),
    filterAccessibleSlugs: (user, slugs) =>
      client.query(
        api.access.filterAccessibleSlugs,
        withSiteSlug(siteSlug, { userId: user._id as Id<"users">, slugs }),
      ),
    listAllowedManifestPage: (user, args) => client.query(api.access.listAllowedSensitiveManifestPage,
      withSiteSlug(siteSlug, { ...args, userId: user._id as Id<"users"> })),
    getAllowedSlugs: (user) => loadAllowedSensitivePages(
      (cursor, numItems) => client.query(api.access.listAllowedSensitivePage,
        withSiteSlug(siteSlug, { cursor, numItems, userId: user._id as Id<"users"> })),
    ),
  };
}

export async function filterAccessiblePages<T extends { slug: string; sensitive?: boolean }>(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  pages: Array<T | null>,
): Promise<T[]> {
  const present = pages.filter((page): page is T => page !== null);
  const allowed = await fetchAccessibleSlugs(
    client,
    siteSlug,
    user,
    present.filter((page) => page.sensitive === true).map((page) => page.slug),
  );
  return present.filter((page) => page.sensitive !== true || allowed.has(page.slug));
}

export async function filterPotentiallySensitivePages<T extends { slug: string; sensitive?: boolean }>(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  pages: Array<T | null>,
): Promise<T[]> {
  const present = pages.filter((page): page is T => page !== null);
  const unknown = present.filter((page) => page.sensitive !== true && page.sensitive !== false);
  const sensitivity = await fetchSlugSensitivity(client, siteSlug, unknown.map((page) => page.slug));
  const isSensitive = (page: T) =>
    page.sensitive === true || (page.sensitive !== false && sensitivity.get(page.slug) === true);
  const allowed = await fetchAccessibleSlugs(
    client,
    siteSlug,
    user,
    present.filter(isSensitive).map((page) => page.slug),
  );
  return present.filter((page) => !isSensitive(page) || allowed.has(page.slug));
}

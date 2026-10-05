import type { WikiApiDocumentsGateway, WikiPublicSubset } from "@oncobase/wiki-content/server";
import { isEducationSlug } from "../src/education-access";

export { isEducationSlug } from "../src/education-access";

export function isPublicEducationPage(page: { slug: string; sensitive?: boolean } | null | undefined) {
  return Boolean(page && page.sensitive === false && isEducationSlug(page.slug));
}

export function isPublicEducationAsset(asset: {
  path: string; sensitive?: boolean; ownerSlugs?: string[];
}, publicOwnerSlugs: ReadonlySet<string> = new Set()) {
  return isEducationSlug(asset.path) && asset.sensitive === false &&
    Array.isArray(asset.ownerSlugs) && asset.ownerSlugs.length > 0 &&
    asset.ownerSlugs.some(isEducationSlug) &&
    asset.ownerSlugs.every(slug => isEducationSlug(slug) || publicOwnerSlugs.has(slug));
}

/** A public lesson may reuse an illustration also owned by a public wiki page.
 * Verify those other owners rather than changing their published ownership. */
export async function canReadEducationAsset(
  asset: Parameters<typeof isPublicEducationAsset>[0],
  getOwner: (slug: string) => Promise<{ sensitive?: boolean } | null>,
) {
  if (!isEducationSlug(asset.path) || asset.sensitive !== false ||
    !asset.ownerSlugs?.some(isEducationSlug)) return false;
  const publicOwners = new Set<string>();
  try {
    await Promise.all(asset.ownerSlugs.filter(slug => !isEducationSlug(slug)).map(async slug => {
      if ((await getOwner(slug))?.sensitive === false) publicOwners.add(slug);
    }));
  } catch { return false; }
  return isPublicEducationAsset(asset, publicOwners);
}

/** Preserve backend cursors even when a batch contains no curriculum pages. */
export function educationDocumentsGateway(documents: WikiApiDocumentsGateway): WikiApiDocumentsGateway {
  const owners = new Map<string, ReturnType<WikiApiDocumentsGateway["getBySlug"]>>();
  const getOwner = (slug: string) => {
    if (!owners.has(slug)) owners.set(slug, documents.getBySlug({ slug, includeSensitive: false }));
    return owners.get(slug)!;
  };
  const manifest: WikiApiDocumentsGateway["listManifestPage"] = async args => {
    const result = await documents.listManifestPage({ ...args, includeSensitive: false });
    return { ...result, page: result.page.filter(isPublicEducationPage) };
  };
  const visibility = (method: "listPdfAssetVisibilityPage" | "listFileAssetVisibilityPage") => async (args: Parameters<WikiApiDocumentsGateway[typeof method]>[0]) => {
    const result = await documents[method]({ ...args, includeSensitive: false });
    const readable = await Promise.all(result.page.map(asset => canReadEducationAsset(asset, getOwner)));
    return { ...result, page: result.page.filter((_, index) => readable[index]) };
  };
  const pdfAssets = visibility("listPdfAssetVisibilityPage");
  const fileAssets = visibility("listFileAssetVisibilityPage");
  return {
    listManifestPage: manifest,
    listPageWithContent: async args => {
      const result = await documents.listPageWithContent({ ...args, includeSensitive: false });
      return { ...result, page: result.page.filter(isPublicEducationPage) };
    },
    listPdfAssetVisibilityPage: pdfAssets,
    listFileAssetVisibilityPage: fileAssets,
    listPdfAssetPathsPage: async args => {
      const result = await pdfAssets(args);
      return { ...result, page: result.page.map(asset => asset.path) };
    },
    listFileAssetPathsPage: async args => {
      const result = await fileAssets(args);
      return { ...result, page: result.page.map(asset => asset.path) };
    },
    getBySlug: async args => {
      if (!isEducationSlug(args.slug)) return null;
      const page = await documents.getBySlug({ slug: args.slug, includeSensitive: false });
      return isPublicEducationPage(page) ? page : null;
    },
  };
}

/** The education manifest as a filter of the public snapshot. Snapshot pages
 * are all explicitly non-sensitive and snapshot assets are complete,
 * non-sensitive PDFs, so the live gateway's page and slug/path rules reduce to
 * these. The one rule a snapshot cannot express is asset ownership (an
 * education-path asset needs an education owner); the file route still
 * enforces it with canReadEducationAsset. Pinned by education-manifest.test.ts. */
export const educationManifestSubset: WikiPublicSubset = {
  name: "education",
  includePage: isPublicEducationPage,
  includeAsset: asset => asset.kind === "pdf" && isEducationSlug(asset.path),
};

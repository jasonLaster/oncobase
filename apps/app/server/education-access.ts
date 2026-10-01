import type { WikiApiDocumentsGateway } from "@oncobase/wiki-content/server";
import { isEducationSlug } from "../src/education-access";

export { isEducationSlug } from "../src/education-access";

export function isPublicEducationPage(page: { slug: string; sensitive?: boolean } | null | undefined) {
  return Boolean(page && page.sensitive === false && isEducationSlug(page.slug));
}

export function isPublicEducationAsset(asset: {
  path: string; sensitive?: boolean; ownerSlugs?: string[];
}) {
  return isEducationSlug(asset.path) && asset.sensitive === false &&
    Array.isArray(asset.ownerSlugs) && asset.ownerSlugs.length > 0 &&
    asset.ownerSlugs.every(isEducationSlug);
}

/** Preserve backend cursors even when a batch contains no curriculum pages. */
export function educationDocumentsGateway(documents: WikiApiDocumentsGateway): WikiApiDocumentsGateway {
  const manifest: WikiApiDocumentsGateway["listManifestPage"] = async args => {
    const result = await documents.listManifestPage({ ...args, includeSensitive: false });
    return { ...result, page: result.page.filter(isPublicEducationPage) };
  };
  const visibility = (method: "listPdfAssetVisibilityPage" | "listFileAssetVisibilityPage") => async (args: Parameters<WikiApiDocumentsGateway[typeof method]>[0]) => {
    const result = await documents[method]({ ...args, includeSensitive: false });
    return { ...result, page: result.page.filter(isPublicEducationAsset) };
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

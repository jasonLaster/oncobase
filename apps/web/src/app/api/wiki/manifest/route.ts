import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import { createWikiManifestResponse } from "@oncobase/wiki-content/server";

export async function GET(request: Request) {
  const siteData = siteDataFromRequest(request);
  const prioritySiteData = siteData as typeof siteData & {
    manifestPrioritySlugs?: string[];
  };
  const access = {
    canUserAccessSlug: (user: { _id: string }, slug: string) =>
      siteData.access.canUserAccessSlug({ userId: user._id, slug }),
    getAllowedSlugs: (user: { _id: string }) =>
      siteData.access.getAllowedSlugs({ userId: user._id }),
  };
  return createWikiManifestResponse(request, {
    siteSlug: siteData.siteSlug,
    documents: siteData.documents,
    getSessionUser: getSessionUserFromRequest,
    access,
    manifestPrioritySlugs: prioritySiteData.manifestPrioritySlugs,
    decorateHeaders: (headers) => wikiApiHeaders(request, headers),
    logger: console,
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}

import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import { createWikiSessionResponse } from "@oncobase/wiki-content/server";

export async function GET(request: Request) {
  const siteData = siteDataFromRequest(request);
  const access = siteData.access
    ? {
        canUserAccessSlug: (user: { _id: string }, slug: string) =>
          siteData.access.canUserAccessSlug({ userId: user._id, slug }),
        getAllowedSlugs: (user: { _id: string }) =>
          siteData.access.getAllowedSlugs({ userId: user._id }),
      }
    : undefined;
  return createWikiSessionResponse(request, {
    siteSlug: siteData.siteSlug,
    documents: siteData.documents,
    getSessionUser: getSessionUserFromRequest,
    access,
    decorateHeaders: (headers) => wikiApiHeaders(request, headers),
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}

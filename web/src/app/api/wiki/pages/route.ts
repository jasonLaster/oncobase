import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import { createWikiPagesResponse } from "@diana-tnbc/wiki-content/server";

export async function GET(request: Request) {
  const siteData = siteDataFromRequest(request);
  return createWikiPagesResponse(request, {
    siteSlug: siteData.siteSlug,
    documents: siteData.documents,
    getSessionUser: getSessionUserFromRequest,
    decorateHeaders: (headers) => wikiApiHeaders(request, headers),
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}

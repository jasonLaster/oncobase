import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import { createWikiManifestResponse } from "@oncobase/wiki-content/server";

export async function GET(request: Request) {
  const siteData = siteDataFromRequest(request);
  const prioritySiteData = siteData as typeof siteData & {
    manifestPrioritySlugs?: string[];
  };
  return createWikiManifestResponse(request, {
    siteSlug: siteData.siteSlug,
    documents: siteData.documents,
    getSessionUser: getSessionUserFromRequest,
    manifestPrioritySlugs: prioritySiteData.manifestPrioritySlugs,
    decorateHeaders: (headers) => wikiApiHeaders(request, headers),
    logger: console,
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}

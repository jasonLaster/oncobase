import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { browserConversationToken } from "@/lib/reference-backend-client";
import { siteSlugFromRequest } from "@/lib/site";
import { hasValidWikiGateCookie, wikiGateCookieName } from "@/lib/wiki-gate-session";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };

export async function GET(request: NextRequest) {
  const slug = siteSlugFromRequest(request);
  const site = await getConvexServerClient().query(api.sites.getBySlug, { slug });
  if (!site) return new NextResponse(null, { status: 404, headers });
  if (site.config.passwordGate && !await hasValidWikiGateCookie(
    slug, request.cookies.get(wikiGateCookieName(slug))?.value,
    site.config.passwordHash, site.config.passwordGate,
  )) return new NextResponse(null, { status: 401, headers });
  return NextResponse.json({ token: await browserConversationToken(site) }, { headers });
}

import crypto from "node:crypto";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { siteDataFromRequest } from "@/lib/site-data";
import { wikiApiHeaders, wikiApiOptions } from "@/lib/wiki-api-cors";
import type { WikiScope, WikiSessionIdentity } from "@diana-tnbc/wiki-content";

const SESSION_CACHE_VERSION = "v1";

function requestedScope(request: Request): WikiScope {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "session" ? "session" : "public";
}

function userHash(siteSlug: string, userId: string) {
  return crypto
    .createHash("sha256")
    .update(`${siteSlug}:${userId}:${SESSION_CACHE_VERSION}`)
    .digest("hex")
    .slice(0, 24);
}

export async function GET(request: Request) {
  const scope = requestedScope(request);
  const siteData = siteDataFromRequest(request);

  if (scope === "public") {
    const identity: WikiSessionIdentity = {
      siteSlug: siteData.siteSlug,
      scope,
      authenticated: false,
      cacheVersion: SESSION_CACHE_VERSION,
      cacheKey: `${siteData.siteSlug}:public:${SESSION_CACHE_VERSION}`,
      userHash: null,
    };
    return Response.json(identity, {
      headers: wikiApiHeaders(request, {
        "Cache-Control": "public, max-age=300",
        Vary: "Accept, x-site-slug",
      }),
    });
  }

  const sessionUser = await getSessionUserFromRequest(request);
  if (!sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: wikiApiHeaders(request, { "Cache-Control": "private, no-store" }),
      },
    );
  }

  const hash = userHash(siteData.siteSlug, sessionUser._id);
  const identity: WikiSessionIdentity = {
    siteSlug: siteData.siteSlug,
    scope,
    authenticated: true,
    cacheVersion: SESSION_CACHE_VERSION,
    cacheKey: `${siteData.siteSlug}:session:${hash}:${SESSION_CACHE_VERSION}`,
    userHash: hash,
  };

  return Response.json(identity, {
    headers: wikiApiHeaders(request, {
      "Cache-Control": "private, no-store",
      Vary: "Accept, Cookie, x-site-slug",
    }),
  });
}

export function OPTIONS(request: Request) {
  return wikiApiOptions(request);
}

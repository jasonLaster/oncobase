import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { handleAiSearchRequest } from "../ai-search";
import type { ApiRouteRequest } from "../api-routes";
import { getSessionUser, withSiteSlug } from "../reader-access";

export async function handleAiSearchRoute({ request, client, siteSlug }: ApiRouteRequest) {
  const scope = new URL(request.url).searchParams.get("scope") === "session"
    ? "session"
    : "public";
  const sessionUser = scope === "session"
    ? await getSessionUser(request, client, siteSlug)
    : null;
  if (request.method === "POST" && scope === "session" && !sessionUser) {
    return Response.json(
      { error: "Session scope requires a signed-in wiki session" },
      {
        status: 401,
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Accept, Cookie, Host",
          "X-Wiki-Cache-Scope": "session",
        },
      },
    );
  }
  return handleAiSearchRequest({
    request,
    client,
    siteSlug,
    includeSensitive: scope === "session" && Boolean(sessionUser),
    allowedSensitiveSlugs: async (slugs) => {
      if (!sessionUser) return new Set();
      const access = await client.query(
        api.access.filterAccessibleSlugs,
        withSiteSlug(siteSlug, { userId: sessionUser._id as Id<"users">, slugs }),
      );
      return new Set(access.filter(result => result.allowed).map(result => result.slug));
    },
  });
}

import { api } from "../../convex/_generated/api.js";
import type { ApiRouteRequest } from "../api-routes";
import { browserConversationToken } from "../backend-client";
import { resolveChatOwner } from "../chat-owner";
import { getSessionUser } from "../reader-access";

export async function handleConvexTokenRequest({ request, client, siteSlug }: ApiRouteRequest) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
  if (request.method !== "GET") return new Response(null, { status: 405, headers });
  const [site, sessionUser] = await Promise.all([
    client.query(api.sites.getBySlug, { slug: siteSlug }),
    getSessionUser(request, client, siteSlug),
  ]);
  // Conversation tokens exist only for chat; a site with chat disabled
  // never hands browsers a Convex credential.
  if (!site || !site.config.enableChat) return new Response(null, { status: 404, headers });
  const owner = resolveChatOwner(request, siteSlug, sessionUser, { issue: true });
  const token = await browserConversationToken(site, owner.ownerKey);
  return Response.json({ token }, { headers: owner.setCookie ? { ...headers, "Set-Cookie": owner.setCookie } : headers });
}

import type { ApiRouteRequest } from "../api-routes";
import { resolveChatOwner } from "../chat-owner";
import { handleChatRequest } from "../chat-route";
import { canUserAccessSlug, getSessionUser } from "../reader-access";

export async function handleChatRoute({ request, client, siteSlug }: ApiRouteRequest) {
  const sessionUser = await getSessionUser(request, client, siteSlug);
  return handleChatRequest({
    request,
    client,
    siteSlug,
    ownerKey: resolveChatOwner(request, siteSlug, sessionUser).ownerKey,
    includeSensitive: Boolean(sessionUser),
    canAccessSlug: (slug) => canUserAccessSlug(client, siteSlug, sessionUser, slug),
    accessCacheKey: sessionUser ? String(sessionUser._id) : "public",
  });
}

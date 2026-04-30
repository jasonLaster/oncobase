import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { siteSlugFromRequest } from "@/lib/site";
import { USER_SESSION_COOKIE, hashSessionToken } from "@/lib/user-auth";

export type SessionUser = {
  _id: string;
  email: string;
  name: string | null;
  createdAt: number;
};

export async function getSessionUserFromRequest(request: Request): Promise<SessionUser | null> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);

  if (!sessionToken) {
    return null;
  }

  // The session token alone isn't enough — `users` is now a
  // site-scoped table, so we must look up under the active site.
  // A cookie from alpha must not authenticate against diana.
  const siteSlug = siteSlugFromRequest(request);
  const convex = getConvexServerClient();
  return await convex.query(api.users.getSessionUser, {
    tokenHash: hashSessionToken(sessionToken),
    siteSlug,
  });
}

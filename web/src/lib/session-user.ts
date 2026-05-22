import { siteDataFromRequest } from "@/lib/site-data";
import { USER_SESSION_COOKIE, hashSessionToken } from "@/lib/user-auth";
import { getConvexServerClient } from "@/lib/convex-server";
import { api } from "@convex/_generated/api";

export type SessionUser = {
  _id: string;
  email: string;
  name: string | null;
  createdAt: number;
};

export type AdminSessionUser = SessionUser & {
  isAdmin: boolean;
};

type UserRoleSummary = {
  _id: string;
  roles: string[];
};

export async function getSessionUserFromCookieHeader(
  cookieHeader: string,
  requestHeaders: Headers = new Headers({ cookie: cookieHeader })
): Promise<SessionUser | null> {
  const sessionToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);

  if (!sessionToken) {
    return null;
  }

  const siteData = siteDataFromRequest({ headers: requestHeaders });
  return await siteData.users.getSessionUser({
    tokenHash: hashSessionToken(sessionToken),
  });
}

export async function getSessionUserWithAdminFromCookieHeader(
  cookieHeader: string,
  requestHeaders: Headers = new Headers({ cookie: cookieHeader })
): Promise<AdminSessionUser | null> {
  const user = await getSessionUserFromCookieHeader(cookieHeader, requestHeaders);
  if (!user) return null;

  const siteData = siteDataFromRequest({ headers: requestHeaders });
  const [site, users] = await Promise.all([
    getConvexServerClient().query(api.sites.getBySlug, {
      slug: siteData.siteSlug,
    }),
    siteData.access.listUsersWithRoles(),
  ]);
  const userWithRoles = (users as UserRoleSummary[]).find(
    (item) => item._id === user._id,
  );
  const isOwner = site?.ownerEmail.toLowerCase() === user.email.toLowerCase();
  const hasAdminRole =
    userWithRoles?.roles.some((role: string) => role.trim().toLowerCase() === "admin") ??
    false;

  return {
    ...user,
    isAdmin: Boolean(isOwner || hasAdminRole),
  };
}

export async function getSessionUserFromRequest(request: Request): Promise<SessionUser | null> {
  return getSessionUserFromCookieHeader(
    request.headers.get("cookie") ?? "",
    request.headers
  );
}

export async function getSessionUserWithAdminFromRequest(
  request: Request
): Promise<AdminSessionUser | null> {
  return getSessionUserWithAdminFromCookieHeader(
    request.headers.get("cookie") ?? "",
    request.headers
  );
}

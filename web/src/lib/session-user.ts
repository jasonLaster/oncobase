import { siteDataFromRequest } from "@/lib/site-data";
import { USER_SESSION_COOKIE, hashSessionToken } from "@/lib/user-auth";

export type SessionUser = {
  _id: string;
  email: string;
  name: string | null;
  createdAt: number;
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

export async function getSessionUserFromRequest(request: Request): Promise<SessionUser | null> {
  return getSessionUserFromCookieHeader(
    request.headers.get("cookie") ?? "",
    request.headers
  );
}

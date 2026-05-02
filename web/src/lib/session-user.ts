import { siteDataFromRequest } from "@/lib/site-data";
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

  const siteData = siteDataFromRequest(request);
  return await siteData.users.getSessionUser({
    tokenHash: hashSessionToken(sessionToken),
  });
}

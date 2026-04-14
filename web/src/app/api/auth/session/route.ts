import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { USER_SESSION_COOKIE, hashSessionToken } from "@/lib/user-auth";

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);

  if (!sessionToken) {
    return NextResponse.json({ user: null });
  }

  const convex = getConvexServerClient();
  const user = await convex.query(api.users.getSessionUser, {
    tokenHash: hashSessionToken(sessionToken),
  });

  return NextResponse.json({ user });
}

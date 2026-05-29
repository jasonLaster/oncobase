import { NextResponse } from "next/server";
import { siteDataFromRequest } from "@/lib/site-data";
import { USER_SESSION_COOKIE, hashSessionToken } from "@/lib/user-auth";

export async function POST(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const sessionToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);

  if (sessionToken) {
    const siteData = siteDataFromRequest(request);
    await siteData.users.deleteSession({
      tokenHash: hashSessionToken(sessionToken),
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(USER_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

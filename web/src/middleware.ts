import { NextRequest, NextResponse } from "next/server";

const PASSWORDS = ["wallify", "diana"];

export function middleware(request: NextRequest) {
  const isAuthed = request.cookies.get("authed")?.value === "true";
  const isLoginPage = request.nextUrl.pathname === "/login";

  // Magic link: ?token=<password> on any page auto-logs in and strips the param
  const token = request.nextUrl.searchParams.get("token");
  if (token && PASSWORDS.includes(token)) {
    const clean = new URL(request.url);
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    response.cookies.set("authed", "true", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  if (isLoginPage) {
    if (isAuthed) {
      const redirect = request.nextUrl.searchParams.get("redirect") || "/";
      return NextResponse.redirect(new URL(redirect, request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|api/auth|api/login|api/liveblocks|api/post-deploy|api/file|\\.well-known/workflow).*)",
  ],
};

import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const isAuthed = request.cookies.get("authed")?.value === "true";
  const isLoginPage = request.nextUrl.pathname === "/login";

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/login).*)"],
};

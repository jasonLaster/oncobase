import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const isAuthed = request.cookies.get("authed")?.value === "true";
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (isLoginPage) {
    if (isAuthed) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!isAuthed) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/login).*)"],
};

import { NextRequest, NextResponse } from "next/server";

const PASSWORDS = ["wallify", "diana"];

/** GET /api/login?token=<password>&redirect=<path> — magic link auto-login */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirect = request.nextUrl.searchParams.get("redirect") || "/";

  if (!token || !PASSWORDS.includes(token)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.redirect(new URL(redirect, request.url));
  response.cookies.set("authed", "true", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();

  if (PASSWORDS.includes(password)) {
    const response = NextResponse.json({ ok: true });
    response.cookies.set("authed", "true", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  }

  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}

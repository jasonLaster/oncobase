import { NextRequest, NextResponse } from "next/server";

const PASSWORDS = ["wallify", "diana"];

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

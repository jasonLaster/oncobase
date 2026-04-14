import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import {
  USER_SESSION_COOKIE,
  createSessionToken,
  getSessionExpiry,
  getSessionMaxAgeSeconds,
  hashSessionToken,
  normalizeEmail,
  verifyPassword,
} from "@/lib/user-auth";

export async function POST(request: Request) {
  const { email, password } = await request.json();
  const normalizedEmail = normalizeEmail(email ?? "");

  if (!normalizedEmail || typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const convex = getConvexServerClient();
  const user = await convex.query(api.users.getByEmailForAuth, { email: normalizedEmail });

  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  const sessionToken = createSessionToken();
  await convex.mutation(api.users.createSession, {
    userId: user._id,
    tokenHash: hashSessionToken(sessionToken),
    expiresAt: getSessionExpiry(),
  });

  const response = NextResponse.json({
    ok: true,
    user: { email: user.email, name: user.name ?? null },
  });
  response.cookies.set(USER_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: getSessionMaxAgeSeconds(),
  });
  return response;
}

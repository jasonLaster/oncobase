import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import {
  USER_SESSION_COOKIE,
  createPasswordSalt,
  createSessionToken,
  getSessionExpiry,
  getSessionMaxAgeSeconds,
  hashPassword,
  hashSessionToken,
  normalizeEmail,
} from "@/lib/user-auth";

export async function POST(request: Request) {
  try {
    const { email, password, name } = await request.json();
    const normalizedEmail = normalizeEmail(email ?? "");
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const convex = getConvexServerClient();
    const passwordSalt = createPasswordSalt();
    const passwordHash = hashPassword(password, passwordSalt);

    const userId = await convex.mutation(api.users.create, {
      email: normalizedEmail,
      name: trimmedName || undefined,
      passwordHash,
      passwordSalt,
    });

    const sessionToken = createSessionToken();
    await convex.mutation(api.users.createSession, {
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: getSessionExpiry(),
    });

    const response = NextResponse.json({
      ok: true,
      user: { email: normalizedEmail, name: trimmedName || null },
    });
    response.cookies.set(USER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: getSessionMaxAgeSeconds(),
    });
    return response;
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to create account";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

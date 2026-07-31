import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { siteDataFromRequest } from "@/lib/site-data";
import { DEFAULT_SITE_SLUG, siteSlugFromRequest } from "@/lib/site";
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
import {
  hasValidWikiGateCookie,
  wikiGateCookieName,
} from "@/lib/wiki-gate-session";

const PRIVATE_SIGNUP_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Host",
};

export async function POST(request: NextRequest) {
  try {
    const siteSlug = siteSlugFromRequest(request);
    let gateEnabled = siteSlug === DEFAULT_SITE_SLUG;
    let gatePasswordHash: string | undefined;
    try {
      const site = await fetchQuery(api.sites.getBySlug, { slug: siteSlug });
      gateEnabled =
        site?.config?.passwordGate ??
        gateEnabled;
      gatePasswordHash = site?.config?.passwordHash;
    } catch {
      if (siteSlug !== DEFAULT_SITE_SLUG) {
        return NextResponse.json(
          { error: "Unable to verify signup access" },
          { status: 503, headers: PRIVATE_SIGNUP_HEADERS },
        );
      }
    }
    if (
      gateEnabled &&
      !(await hasValidWikiGateCookie(
        siteSlug,
        request.cookies.get(wikiGateCookieName(siteSlug))?.value,
        gatePasswordHash,
        gateEnabled,
      ))
    ) {
      return NextResponse.json(
        { error: "Password gate access is required to create an account" },
        { status: 403, headers: PRIVATE_SIGNUP_HEADERS },
      );
    }

    const { email, password, name } = await request.json();
    const normalizedEmail = normalizeEmail(email ?? "");
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }

    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const siteData = siteDataFromRequest(request);
    const passwordSalt = createPasswordSalt();
    const passwordHash = hashPassword(password, passwordSalt);

    const userId = await siteData.users.create({
      email: normalizedEmail,
      name: trimmedName || undefined,
      passwordHash,
      passwordSalt,
    });

    const sessionToken = createSessionToken();
    await siteData.users.createSession({
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

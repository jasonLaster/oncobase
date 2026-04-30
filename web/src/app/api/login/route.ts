import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { siteSlugFromRequest, DEFAULT_SITE_SLUG } from "@/lib/site";

// Multi-site login. Reads the active site from the proxy-set
// x-site-slug header and validates the password against:
//
//   1. The site's `config.passwordHash` (sha256:<hex>) if present.
//   2. The Diana legacy PASSWORDS array, only when the active site
//      is the Diana default. Lets existing Diana sessions keep
//      working through the migration window.
//
// Sets the per-site cookie `authed_<slug>` for non-Diana sites;
// Diana keeps the legacy `authed` cookie name (matching the proxy's
// authedCookieName helper).
const DIANA_PASSWORDS = ["wallify", "diana"];

function authedCookieName(siteSlug: string) {
  return siteSlug === DEFAULT_SITE_SLUG ? "authed" : `authed_${siteSlug}`;
}

function hashPassword(password: string) {
  return `sha256:${crypto.createHash("sha256").update(password).digest("hex")}`;
}

async function isValidPassword(siteSlug: string, password: string) {
  if (siteSlug === DEFAULT_SITE_SLUG && DIANA_PASSWORDS.includes(password)) {
    return true;
  }
  const site = await fetchQuery(api.sites.getBySlug, { slug: siteSlug });
  if (!site) return false;
  const expected = site.config?.passwordHash;
  if (!expected) {
    // No password gate configured — login is a no-op; pass.
    return !site.config?.passwordGate;
  }
  return hashPassword(password) === expected;
}

/** GET /api/login?token=<password>&redirect=<path> — magic link auto-login. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirect = request.nextUrl.searchParams.get("redirect") || "/";
  const siteSlug = siteSlugFromRequest(request);

  if (!token || !(await isValidPassword(siteSlug, token))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.redirect(new URL(redirect, request.url));
  response.cookies.set(authedCookieName(siteSlug), "true", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const siteSlug = siteSlugFromRequest(request);

  if (await isValidPassword(siteSlug, password)) {
    const response = NextResponse.json({ ok: true });
    response.cookies.set(authedCookieName(siteSlug), "true", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}

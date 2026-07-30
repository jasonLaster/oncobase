import { NextRequest, NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { siteSlugFromRequest } from "@/lib/site";
import { safeLocalRedirect } from "@/lib/safe-redirect";
import {
  createWikiGateCookieValue,
  isValidWikiPassword,
  WIKI_GATE_COOKIE_MAX_AGE,
  wikiGateCookieName,
} from "@/lib/wiki-gate-session";

// Multi-site login. Reads the active site from the proxy-set
// x-site-slug header and validates the password against:
//
//   1. The site's `config.passwordHash` (sha256:<hex>) if present.
//   2. DIANA_WIKI_PASSWORD_HASH for the Diana migration fallback.
//
// Sets the per-site cookie `authed_<slug>` for non-Diana sites;
// Diana keeps the legacy `authed` cookie name (matching the proxy's
// authedCookieName helper).
async function isValidPassword(siteSlug: string, password: string) {
  if (await isValidWikiPassword(siteSlug, password)) return true;
  const site = await fetchQuery(api.sites.getBySlug, { slug: siteSlug });
  if (!site) return false;
  if (!site.config?.passwordHash && !site.config?.passwordGate) {
    // No password gate configured — login is a no-op; pass.
    return true;
  }
  return isValidWikiPassword(siteSlug, password, site.config?.passwordHash);
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Host",
  };
}

async function setGateCookie(response: NextResponse, siteSlug: string) {
  response.cookies.set(
    wikiGateCookieName(siteSlug),
    await createWikiGateCookieValue(siteSlug),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: WIKI_GATE_COOKIE_MAX_AGE,
    },
  );
}

/** GET /api/login?token=<password>&redirect=<path> — magic link auto-login. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const redirect = safeLocalRedirect(
    request.nextUrl.searchParams.get("redirect"),
  );
  const siteSlug = siteSlugFromRequest(request);

  if (!token || !(await isValidPassword(siteSlug, token))) {
    return NextResponse.redirect(new URL("/login", request.url), {
      headers: privateHeaders(),
    });
  }

  const response = NextResponse.redirect(new URL(redirect, request.url), {
    headers: privateHeaders(),
  });
  try {
    await setGateCookie(response, siteSlug);
  } catch {
    return NextResponse.json(
      { error: "Password gate session is not configured" },
      { status: 503, headers: privateHeaders() },
    );
  }
  return response;
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const siteSlug = siteSlugFromRequest(request);

  if (await isValidPassword(siteSlug, password)) {
    const response = NextResponse.json({ ok: true }, {
      headers: privateHeaders(),
    });
    try {
      await setGateCookie(response, siteSlug);
    } catch {
      return NextResponse.json(
        { error: "Password gate session is not configured" },
        { status: 503, headers: privateHeaders() },
      );
    }
    return response;
  }

  return NextResponse.json(
    { error: "Invalid password" },
    { status: 401, headers: privateHeaders() },
  );
}

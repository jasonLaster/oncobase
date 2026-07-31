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
async function validatePassword(siteSlug: string, password: string) {
  const site = await fetchQuery(api.sites.getBySlug, { slug: siteSlug }).catch(
    () => null,
  );
  const configuredHash = site?.config?.passwordHash;
  if (
    configuredHash &&
    await isValidWikiPassword(siteSlug, password, configuredHash)
  ) {
    return { configuredHash };
  }
  if (await isValidWikiPassword(siteSlug, password)) {
    return { configuredHash };
  }
  if (site && !configuredHash && !site.config?.passwordGate) {
    // No password gate configured — login is a no-op; pass.
    return { configuredHash };
  }
  return null;
}

function privateHeaders() {
  return {
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Host",
  };
}

async function setGateCookie(
  response: NextResponse,
  siteSlug: string,
  configuredHash?: string | null,
) {
  response.cookies.set(
    wikiGateCookieName(siteSlug),
    await createWikiGateCookieValue(siteSlug, configuredHash),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: WIKI_GATE_COOKIE_MAX_AGE,
    },
  );
}

/** GET /api/login redirects to the password form without accepting credentials in the URL. */
export function GET(request: NextRequest) {
  const redirect = safeLocalRedirect(
    request.nextUrl.searchParams.get("redirect"),
  );
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", redirect);
  return NextResponse.redirect(loginUrl, {
    headers: privateHeaders(),
  });
}

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const siteSlug = siteSlugFromRequest(request);

  const validation = await validatePassword(siteSlug, password);
  if (validation) {
    const response = NextResponse.json({ ok: true }, {
      headers: privateHeaders(),
    });
    try {
      await setGateCookie(response, siteSlug, validation.configuredHash);
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

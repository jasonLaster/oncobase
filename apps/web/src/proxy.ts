import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { isLinkPreviewBotUserAgent } from "@oncobase/wiki-content/link-preview";
import { api } from "@convex/_generated/api";
import { resolveServerConvexUrl } from "@/lib/convex-url";
import { safeLocalRedirect } from "@/lib/safe-redirect";
import {
  hasValidWikiGateCookie,
  wikiGateCookieName,
} from "@/lib/wiki-gate-session";
import localHosts from "../.local-hosts.json";

// Phase 3 multi-tenant: resolve the active site from the Host header
// once per request, set `x-site-slug` on the forwarded headers, then
// run the password gate scoped to that site.

const DIANA_TEST_AUTH_HEADER = "x-diana-test-auth";
const USER_SESSION_COOKIE = "wiki_user_session";
const CANONICAL_PATHS = new Map([["/about/index", "/about/Index"]]);

const DEFAULT_SITE_SLUG = "diana";
const HOST_CACHE_TTL_MS = 15_000;
const VERCEL_PROJECT_HOST_PREFIX = "diana-tnbc";
const PUBLIC_FILE_RE =
  /\.(?:avif|css|csv|gif|html|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?|zip)$/i;
const PUBLIC_PAGES = new Set(["/terms-and-conditions"]);

type ResolvedSite = {
  slug: string;
  expires: number;
};

type CurrentGateConfig = {
  passwordGate: boolean;
  passwordHash?: string;
};

const hostCache = new Map<string, ResolvedSite>();
let convexClient: ConvexHttpClient | null = null;
let convexClientOverride: ConvexHttpClient | null | undefined;

type UserRoleSummary = {
  _id: string;
  roles: string[];
};

function getConvex() {
  if (convexClientOverride !== undefined) return convexClientOverride;
  const url = resolveServerConvexUrl();
  if (!url) return null;
  if (!convexClient) {
    convexClient = new ConvexHttpClient(url);
  }
  return convexClient;
}

function normalizeHost(host: string | null) {
  return host?.toLowerCase().split(":")[0] ?? null;
}

function localSiteForHost(host: string): string | null {
  const override = process.env.SITE_SLUG;
  if (override) return override;
  const configured = (localHosts as Record<string, string>)[host];
  if (configured) return configured;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return DEFAULT_SITE_SLUG;
  }
  if (host.endsWith(".localhost")) {
    return host.slice(0, -".localhost".length);
  }
  return null;
}

function previewSiteForHost(host: string): string | null {
  const override = process.env.SITE_SLUG;
  if (override) return override;
  if (process.env.VERCEL_ENV !== "preview") return null;
  if (!host.endsWith(".vercel.app")) return null;
  if (
    host === `${VERCEL_PROJECT_HOST_PREFIX}.vercel.app` ||
    host.startsWith(`${VERCEL_PROJECT_HOST_PREFIX}-`)
  ) {
    return DEFAULT_SITE_SLUG;
  }
  return null;
}

function entryForSlug(siteSlug: string): ResolvedSite {
  return {
    slug: siteSlug,
    expires: Date.now() + HOST_CACHE_TTL_MS,
  };
}

async function currentGateConfig(siteSlug: string): Promise<CurrentGateConfig> {
  const convex = getConvex();
  if (!convex) {
    return { passwordGate: siteSlug === DEFAULT_SITE_SLUG };
  }
  const site = await convex.query(api.sites.getBySlug, { slug: siteSlug });
  if (!site) throw new Error(`Unknown wiki site: ${siteSlug}`);
  return {
    passwordGate:
      site.config.passwordGate ?? siteSlug === DEFAULT_SITE_SLUG,
    passwordHash: site.config.passwordHash,
  };
}

export function setProxyConvexClientForTests(
  client: ConvexHttpClient | null | undefined,
) {
  convexClientOverride = client;
  hostCache.clear();
}

async function resolveHost(host: string): Promise<ResolvedSite | null> {
  const hit = hostCache.get(host);
  if (hit && hit.expires > Date.now()) return hit;

  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const localSlug = localSiteForHost(host);
    if (localSlug) {
      const entry = entryForSlug(localSlug);
      hostCache.set(host, entry);
      return entry;
    }
  }

  const previewSlug = previewSiteForHost(host);
  if (previewSlug) {
    const entry = entryForSlug(previewSlug);
    hostCache.set(host, entry);
    return entry;
  }

  const convex = getConvex();
  if (!convex) {
    // No Convex configured — fall back to Diana so dev still works.
    const entry = entryForSlug(DEFAULT_SITE_SLUG);
    hostCache.set(host, entry);
    return entry;
  }

  try {
    const site = await convex.query(api.sites.getByHost, { host });
    if (!site) {
      // Cache the miss briefly so unknown-host floods don't hammer Convex.
      const miss: ResolvedSite = {
        slug: "",
        expires: Date.now() + HOST_CACHE_TTL_MS,
      };
      hostCache.set(host, miss);
      return null;
    }
    const entry: ResolvedSite = {
      slug: site.slug,
      expires: Date.now() + HOST_CACHE_TTL_MS,
    };
    hostCache.set(host, entry);
    return entry;
  } catch {
    // Preserve localhost identity; the uncached gate-config lookup below still
    // fails closed before protected content is served.
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      const entry = entryForSlug(DEFAULT_SITE_SLUG);
      hostCache.set(host, entry);
      return entry;
    }
    return null;
  }
}

function withSiteHeader(request: NextRequest, siteSlug: string) {
  const requestHeaders = new Headers(request.headers);
  // Always overwrite — never trust an incoming x-site-slug from the
  // client. Header injection is defended at this single point.
  requestHeaders.set("x-site-slug", siteSlug);
  return requestHeaders;
}

const PRIVATE_GATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie, Host",
};

function privateNext(requestHeaders: Headers) {
  return NextResponse.next({
    request: { headers: requestHeaders },
    headers: PRIVATE_GATE_HEADERS,
  });
}

function privateRedirect(url: URL) {
  return NextResponse.redirect(url, { headers: PRIVATE_GATE_HEADERS });
}

function getCookieValue(cookieHeader: string, name: string) {
  return cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function hashSessionToken(token: string) {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function notFoundHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>404: This page could not be found.</title>
  </head>
  <body>
    <main>
      <h1>404</h1>
      <h2>This page could not be found.</h2>
    </main>
  </body>
</html>`;
}

async function hasAdminSession(cookieHeader: string, siteSlug: string) {
  const sessionToken = getCookieValue(cookieHeader, USER_SESSION_COOKIE);
  if (!sessionToken) {
    return false;
  }

  const convex = getConvex();
  if (!convex) {
    return false;
  }

  const tokenHash = await hashSessionToken(sessionToken);
  const [user, site, users] = await Promise.all([
    convex.query(api.users.getSessionUser, {
      siteSlug,
      tokenHash,
    }),
    convex.query(api.sites.getBySlug, { slug: siteSlug }),
    convex.query(api.access.listUsersWithRoles, { siteSlug }),
  ]);

  if (!user) {
    return false;
  }

  const userWithRoles = (users as UserRoleSummary[]).find(
    (item) => item._id === user._id,
  );
  const isOwner = site?.ownerEmail?.toLowerCase() === user.email.toLowerCase();
  const hasAdminRole =
    userWithRoles?.roles.some((role) => role.trim().toLowerCase() === "admin") ??
    false;
  return Boolean(isOwner || hasAdminRole);
}

function isDianaPreviewTestAuth(request: NextRequest, site: ResolvedSite) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return (
    process.env.VERCEL_ENV === "preview" &&
    site.slug === DEFAULT_SITE_SLUG &&
    Boolean(secret) &&
    request.headers.get(DIANA_TEST_AUTH_HEADER) === secret
  );
}

export async function proxy(request: NextRequest) {
  const canonicalPath = CANONICAL_PATHS.get(request.nextUrl.pathname);
  if (canonicalPath) {
    const canonicalUrl = request.nextUrl.clone();
    canonicalUrl.pathname = canonicalPath;
    return NextResponse.redirect(canonicalUrl);
  }

  const host = normalizeHost(request.headers.get("host"));
  if (!host) return new NextResponse("missing host", { status: 400 });

  let site: ResolvedSite | null = null;
  try {
    site = await resolveHost(host);
  } catch (error) {
    console.error("[proxy] host resolution failed", error);
    return new NextResponse("site lookup unavailable", { status: 503 });
  }

  if (!site || !site.slug) {
    return new NextResponse("unknown host", { status: 404 });
  }

  const requestHeaders = withSiteHeader(request, site.slug);

  if (request.nextUrl.pathname.startsWith("/pii-view")) {
    const cookieHeader = request.headers.get("cookie") ?? "";
    if (!(await hasAdminSession(cookieHeader, site.slug))) {
      return new NextResponse(notFoundHtml(), {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
        },
      });
    }
  }

  // Auth/login routes own their own auth flow and the public wiki session
  // endpoint bootstraps the reader's cache identity. Content endpoints stay
  // behind the site password gate; OPTIONS carries no content and must reach
  // the route's CORS handler.
  if (
    (request.method === "OPTIONS" &&
      request.nextUrl.pathname.startsWith("/api/")) ||
    request.nextUrl.pathname.startsWith("/api/login") ||
    request.nextUrl.pathname.startsWith("/api/auth") ||
    request.nextUrl.pathname.startsWith("/api/publish") ||
    request.nextUrl.pathname.startsWith("/api/integrations/epic") ||
    request.nextUrl.pathname === "/api/wiki/session" ||
    PUBLIC_PAGES.has(request.nextUrl.pathname) ||
    PUBLIC_FILE_RE.test(request.nextUrl.pathname)
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let gateConfig: CurrentGateConfig;
  try {
    gateConfig = await currentGateConfig(site.slug);
  } catch (error) {
    console.error("[proxy] password gate lookup failed", error);
    return new NextResponse("password gate configuration unavailable", {
      status: 503,
      headers: PRIVATE_GATE_HEADERS,
    });
  }

  const cookieName = wikiGateCookieName(site.slug);
  const isAuthed =
    await hasValidWikiGateCookie(
      site.slug,
      request.cookies.get(cookieName)?.value,
      gateConfig.passwordHash,
      gateConfig.passwordGate,
    ) ||
    isDianaPreviewTestAuth(request, site);
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isSharePreviewRequest =
    (request.method === "GET" || request.method === "HEAD") &&
    isLinkPreviewBotUserAgent(request.headers.get("user-agent"));

  // Passwords in URLs can leak through history, logs, and referrers. Strip the
  // legacy parameter without authenticating it.
  if (request.nextUrl.searchParams.has("token")) {
    const clean = new URL(request.url);
    clean.searchParams.delete("token");
    return privateRedirect(clean);
  }

  if (isLoginPage) {
    if (isAuthed || !gateConfig.passwordGate) {
      const redirect = safeLocalRedirect(
        request.nextUrl.searchParams.get("redirect"),
      );
      return privateRedirect(new URL(redirect, request.url));
    }
    return privateNext(requestHeaders);
  }

  if (gateConfig.passwordGate && !isAuthed && isSharePreviewRequest) {
    const previewUrl = new URL("/api/share-preview", request.url);
    previewUrl.searchParams.set("path", request.nextUrl.pathname);
    requestHeaders.set("x-share-preview-path", request.nextUrl.pathname);
    return NextResponse.rewrite(previewUrl, {
      request: { headers: requestHeaders },
    });
  }

  if (gateConfig.passwordGate && !isAuthed) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Password gate authentication required" },
        { status: 401, headers: PRIVATE_GATE_HEADERS },
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return privateRedirect(loginUrl);
  }

  return gateConfig.passwordGate || isAuthed
    ? privateNext(requestHeaders)
    : NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Content APIs are inside the matcher so the proxy can set x-site-slug
    // and enforce the active site's password gate before route execution.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sw\\.js|api/share-preview|api/post-deploy|\\.well-known/workflow).*)",
  ],
};

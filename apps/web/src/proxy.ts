import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { resolveServerConvexUrl } from "@/lib/convex-url";
import localHosts from "../.local-hosts.json";

// Phase 3 multi-tenant: resolve the active site from the Host header
// once per request, set `x-site-slug` on the forwarded headers, then
// run the password gate scoped to that site.

const PASSWORDS = ["wallify", "diana"];
const DIANA_TEST_AUTH_HEADER = "x-diana-test-auth";
const CANONICAL_PATHS = new Map([["/about/index", "/about/Index"]]);
const LINK_PREVIEW_BOT_RE =
  /\b(slackbot|twitterbot|facebookexternalhit|facebot|linkedinbot|discordbot|whatsapp|telegrambot|skypeuripreview|microsoftpreview|teamsbot|pinterest|redditbot|applebot)\b/i;

const DEFAULT_SITE_SLUG = "diana";
const HOST_CACHE_TTL_MS = 15_000;
const VERCEL_PROJECT_HOST_PREFIX = "diana-tnbc";
const PUBLIC_FILE_RE =
  /\.(?:avif|css|csv|gif|html|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|txt|webm|webp|woff2?|zip)$/i;

type ResolvedSite = {
  slug: string;
  passwordGate: boolean;
  passwordHash?: string;
  expires: number;
};

const hostCache = new Map<string, ResolvedSite>();
let convexClient: ConvexHttpClient | null = null;

function getConvex() {
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
    // Diana keeps the existing global password gate during the migration
    // window. Other explicit site overrides default to no gate unless
    // Convex resolves their real config.
    passwordGate: siteSlug === DEFAULT_SITE_SLUG,
    expires: Date.now() + HOST_CACHE_TTL_MS,
  };
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
        passwordGate: false,
        expires: Date.now() + HOST_CACHE_TTL_MS,
      };
      hostCache.set(host, miss);
      return null;
    }
    const entry: ResolvedSite = {
      slug: site.slug,
      passwordGate: site.config.passwordGate ?? false,
      passwordHash: site.config.passwordHash,
      expires: Date.now() + HOST_CACHE_TTL_MS,
    };
    hostCache.set(host, entry);
    return entry;
  } catch {
    // Convex outage — fail closed for new hosts, fail open for Diana.
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      const entry = entryForSlug(DEFAULT_SITE_SLUG);
      hostCache.set(host, entry);
      return entry;
    }
    return null;
  }
}

function authedCookieName(siteSlug: string) {
  // Diana keeps the legacy "authed" cookie name during the migration
  // window so existing sessions don't get logged out. Other sites
  // get prefixed cookies from day one.
  return siteSlug === DEFAULT_SITE_SLUG ? "authed" : `authed_${siteSlug}`;
}

async function hashPassword(password: string) {
  const encoded = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `sha256:${hex}`;
}

async function isValidMagicToken(token: string, site: ResolvedSite) {
  if (site.slug === DEFAULT_SITE_SLUG) {
    return PASSWORDS.includes(token);
  }
  if (site.passwordHash && (await hashPassword(token)) === site.passwordHash) {
    return true;
  }
  return false;
}

function withSiteHeader(request: NextRequest, siteSlug: string) {
  const requestHeaders = new Headers(request.headers);
  // Always overwrite — never trust an incoming x-site-slug from the
  // client. Header injection is defended at this single point.
  requestHeaders.set("x-site-slug", siteSlug);
  return requestHeaders;
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

  // Auth/login routes own their own auth flow — bypass the password
  // gate but still set x-site-slug. /api/file is here because it's
  // a content endpoint that needs site scoping; the password gate
  // historically didn't apply (excluded from the matcher) and we
  // preserve that, while getting the proxy-set x-site-slug header
  // so the client can't inject a different site.
  if (
    request.nextUrl.pathname.startsWith("/api/login") ||
    request.nextUrl.pathname.startsWith("/api/auth") ||
    request.nextUrl.pathname.startsWith("/api/publish") ||
    request.nextUrl.pathname.startsWith("/api/file") ||
    request.nextUrl.pathname.startsWith("/api/wiki") ||
    PUBLIC_FILE_RE.test(request.nextUrl.pathname)
  ) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const cookieName = authedCookieName(site.slug);
  const isAuthed =
    request.cookies.get(cookieName)?.value === "true" ||
    isDianaPreviewTestAuth(request, site);
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isSharePreviewRequest =
    (request.method === "GET" || request.method === "HEAD") &&
    LINK_PREVIEW_BOT_RE.test(request.headers.get("user-agent") ?? "");

  // Magic link: ?token=<password> auto-logs in and strips the param.
  const token = request.nextUrl.searchParams.get("token");
  if (token && (await isValidMagicToken(token, site))) {
    const clean = new URL(request.url);
    clean.searchParams.delete("token");
    const response = NextResponse.redirect(clean);
    response.cookies.set(cookieName, "true", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  if (isLoginPage) {
    if (isAuthed || !site.passwordGate) {
      const redirect = request.nextUrl.searchParams.get("redirect") || "/";
      return NextResponse.redirect(new URL(redirect, request.url));
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (site.passwordGate && !isAuthed && isSharePreviewRequest) {
    const previewUrl = new URL("/api/share-preview", request.url);
    previewUrl.searchParams.set("path", request.nextUrl.pathname);
    requestHeaders.set("x-share-preview-path", request.nextUrl.pathname);
    return NextResponse.rewrite(previewUrl, {
      request: { headers: requestHeaders },
    });
  }

  if (site.passwordGate && !isAuthed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // /api/file is now inside the matcher so the proxy can set
    // x-site-slug on it (passed through to Convex for site-scoped
    // asset lookups). It still bypasses the password gate via the
    // explicit branch above.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sw\\.js|api/share-preview|api/post-deploy|\\.well-known/workflow).*)",
  ],
};

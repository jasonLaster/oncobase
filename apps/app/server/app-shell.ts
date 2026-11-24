import { createHash } from "node:crypto";
import { readerShellHint } from "../src/bootstrap/reader-shell-hint";
import { landingRouteMetadata, specialRouteMetadata } from "../src/special-route-metadata";
import { isReaderAppRoute } from "../src/reader-app-routes";
import { LANDING_READER_ACCESS, rootRouteFor } from "../src/root-route";
import { injectPageBootstrap, navigationBootstrapScripts, navigationSlice, sessionPageBootstrapScripts } from "./page-bootstrap";
import { contentSlugFromRouteSlug, slugFromPath } from "../src/wiki-utils";
import { parseWikiPageBatch, parseWikiSessionIdentity } from "@oncobase/wiki-content";
import { injectHeadMetadata } from "./html-head";
import { pageDescription, pageSocialImageUrl } from "./page-social-metadata";
import { safeStaticPath, staticHeaders } from "./static-files";
import { handleMarketingRequest, isMarketingRequest, movedToMarketingSite } from "./marketing-site";
import { traceBackendAttributes, traceBackendCache, traceBackendPhase, traceConvexClient } from "./backend-tracing";
import { isProbePath, probeResponse, shellOutcome, shellPathClass } from "./shell-telemetry";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api.js";
import { getDocumentsByTag } from "./document-listing";
import { isLinkPreviewBotUserAgent } from "@oncobase/wiki-content/link-preview";
import { legacyRedirectResponse } from "./redirects.ts";
import { internalReaderNotFound, isInternalReaderPath } from "./reader-cache-context";
import {
  canonicalSlugMap,
  canonicalSlugPathname,
  explicitCanonicalPathname,
  isSignInPathname,
  slugFromRoutePathname,
  trailingSlashCanonicalPathname,
} from "../src/route-canonicalization.ts";
import {
  canUserAccessSlug,
  createClient,
  getSessionUser,
  getRequestPasswordGateConfig,
  hasValidAuthCookie,
  isDianaPreviewTestAuth,
  resolveSiteSlug,
  redactPageContent,
  withSiteSlug,
} from "./reader-access.js";
import {
  DEFAULT_SITE_DESCRIPTION,
  DIANA_SITE_NAME,
  legacyRouteMetadata,
  tagFromPathname,
} from "./legacy-route-metadata.js";
import { safeLocalRedirect } from "../src/safe-redirect.js";
import { isEducationPathname, isEducationSlug } from "../src/education-access";
import { isPublicEducationPage } from "./education-access";
import { educationHref, educationSlugFromPathname, isEducationHubPathname } from "../src/education-routes";

const DEFAULT_SITE_SLUG = "diana";
const CANONICAL_SLUG_CACHE_TTL_MS = 60_000;
const CANONICAL_SLUG_PAGE_SIZE = 512;
const ASSET_PATH_RE = /\.(css|js|json|png|jpg|jpeg|gif|webp|svg|ico|wasm|txt|xml|map)$/i;
const MARKDOWN_ALIAS_PATH_RE = /\.(?:md|mdx)$/i;
// Exact paths only. Never exempt a pattern such as every .md: those are wiki pages.
const PUBLIC_PAGES = new Set(["/terms-and-conditions"]);
const educationRequests = new WeakSet<Request>();
// Signed-out visitors to "/" see the landing page in place of the wiki home.
const landingRequests = new WeakSet<Request>();
// What page data a reader document carries, for the head script (`<html
// data-reader-payload>`): "session" (identity and page), "public" (page), or
// "none" (a page route that carries nothing, so the reader asks right away).
const documentPayloads = new WeakMap<Request, "session" | "public" | "none">();

/** The API router, for answering a document's own reads in-process. */
export type ApiDispatch = (request: Request) => Promise<Response | null>;

/**
 * A document sent in two parts: everything up to `</body>` at once, so the
 * stylesheet, scripts and head requests start without waiting, then the data
 * blocks that need slower reads, then the rest. Module scripts run only after
 * the whole document has been parsed, so the reader always sees the tail.
 */
type StreamedDocument = { head: string; tail: Promise<string>; rest: string };

type CanonicalSlugCacheEntry = {
  expires: number;
  /** In flight or settled. Concurrent cold requests share one listing. */
  map: Promise<Map<string, string>>;
};

type ManifestPageResult = {
  page: Array<{ slug?: unknown }>;
  isDone: boolean;
  continueCursor: string | null;
};

// Scoped to the client it was read through: one per process in production, and
// handlers built on different backends (tests) cannot see each other's listing.
const canonicalSlugCaches = new WeakMap<ConvexHttpClient, Map<string, CanonicalSlugCacheEntry>>();
const requestPublicPages = new WeakMap<Request, Map<string, Promise<FunctionReturnType<typeof api.documents.getBySlug>>>>();

function publicPageForRequest(request: Request, client: ConvexHttpClient, siteSlug: string, slug: string) {
  let pages = requestPublicPages.get(request);
  if (!pages) {
    pages = new Map();
    requestPublicPages.set(request, pages);
  }
  const key = `${siteSlug}:${slug}`;
  let page = pages.get(key);
  if (!page) {
    page = client.query(api.documents.getBySlug, withSiteSlug(siteSlug, { slug }));
    pages.set(key, page);
  }
  return page;
}

function slugFromPathname(pathname: string) {
  if (isEducationHubPathname(pathname)) return educationSlugFromPathname(pathname);
  return slugFromRoutePathname(pathname);
}

function isAppAssetRequest(pathname: string) {
  return pathname.startsWith("/assets/") || pathname.startsWith("/pdf-assets/") || pathname === "/favicon.ico" || ASSET_PATH_RE.test(pathname);
}

function isLinkPreviewRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return isLinkPreviewBotUserAgent(request.headers.get("user-agent"));
}

function sharePreviewRequestFor(request: Request) {
  const url = new URL(request.url);
  const previewUrl = new URL("/api/share-preview", request.url);
  previewUrl.searchParams.set("path", url.pathname);
  const headers = new Headers(request.headers);
  headers.set("x-share-preview-path", url.pathname);
  return new Request(previewUrl, {
    headers,
    method: request.method,
  });
}

function redirectToPath(request: Request, pathname: string, status = 307) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return Response.redirect(target, status);
}

function trailingSlashRedirectResponse(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (isAppAssetRequest(url.pathname)) return null;
  const canonicalPathname = trailingSlashCanonicalPathname(url.pathname);
  return canonicalPathname
    ? redirectToPath(request, canonicalPathname, 308)
    : null;
}

function privateRedirect(request: Request, pathname: string, status = 302) {
  const target = new URL(pathname, request.url);
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Location: target.toString(),
      Vary: "Cookie, Host",
    },
  });
}

function explicitCanonicalRedirectResponse(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const canonicalPath = explicitCanonicalPathname(url.pathname);
  if (!canonicalPath) return null;
  return redirectToPath(request, canonicalPath);
}

function publicCanonicalSlugMap(client: ConvexHttpClient, siteSlug: string) {
  const now = Date.now();
  let canonicalSlugCache = canonicalSlugCaches.get(client);
  if (!canonicalSlugCache) canonicalSlugCaches.set(client, canonicalSlugCache = new Map());
  const cached = canonicalSlugCache.get(siteSlug);
  traceBackendCache("canonical-slugs", Boolean(cached && cached.expires > now));
  if (cached && cached.expires > now) return cached.map;

  const map = (async () => {
    const slugs: string[] = [];
    let cursor: string | null = null;
    let isDone = false;
    while (!isDone) {
      const result = await client.query(
        api.documents.listManifestPage,
        withSiteSlug(siteSlug, {
          cursor,
          numItems: CANONICAL_SLUG_PAGE_SIZE,
        }),
      ) as ManifestPageResult;
      for (const page of result.page) {
        if (typeof page.slug === "string") {
          slugs.push(page.slug);
        }
      }
      cursor = result.continueCursor;
      isDone = result.isDone || !cursor;
    }
    return canonicalSlugMap(slugs);
  })();
  const entry = { expires: now + CANONICAL_SLUG_CACHE_TTL_MS, map };
  canonicalSlugCache.set(siteSlug, entry);
  // A failed listing must not be served for the rest of the TTL.
  map.catch(() => {
    if (canonicalSlugCache.get(siteSlug) === entry) canonicalSlugCache.delete(siteSlug);
  });
  return map;
}

async function canonicalSlugRedirectResponse(
  request: Request,
  client: ConvexHttpClient,
) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (isSignInPathname(url.pathname) || url.pathname.startsWith("/api/") || isAppAssetRequest(url.pathname) || PUBLIC_PAGES.has(url.pathname)) {
    return null;
  }
  // The reader's own pages (chat, admin, diagnostics, ...) are never wiki
  // pages, so no published slug can be their canonical form. Without this,
  // each one paged through the whole site listing (about 1.4-2.2 s).
  if (isReaderAppRoute(url.pathname)) return null;

  const slug = slugFromPathname(url.pathname);
  if (!slug || slug === "index") return null;
  // The client canonical boundary still reconciles cached paths with the
  // refreshed manifest. Avoid fetching the body just to repeat that lookup.
  if (!isEducationHubPathname(url.pathname) && !isLinkPreviewRequest(request) && readerShellHint(request.headers.get("cookie") ?? "", url)) return null;

  const siteSlug = await resolveSiteSlug(request, client);
  if (!siteSlug) return null;

  try {
    // The normal, correctly-cased URL needs one indexed document lookup, not
    // a paginated scan of every document in the site. Reuse it for metadata.
    const page = await publicPageForRequest(request, client, siteSlug, slug);
    if (page?.slug === slug) return null;
    if (isEducationHubPathname(url.pathname)) {
      const directoryIndex = await publicPageForRequest(request, client, siteSlug, `${slug}/index`);
      if (directoryIndex && isPublicEducationPage(directoryIndex)) return redirectToPath(request, educationHref(directoryIndex.slug), 308);
      const canonical = (await publicCanonicalSlugMap(client, siteSlug)).get(slug.toLowerCase());
      return canonical ? redirectToPath(request, educationHref(canonical), 308) : null;
    }
    const canonicalPathname = canonicalSlugPathname(
      url.pathname,
      await publicCanonicalSlugMap(client, siteSlug),
    );
    return canonicalPathname
      ? redirectToPath(request, canonicalPathname)
      : null;
  } catch (error) {
    console.warn("[wiki-vite-server] canonical slug lookup failed", error);
    return null;
  }
}


async function enforcePasswordGate(request: Request, client: ConvexHttpClient) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || isAppAssetRequest(url.pathname)) {
    return null;
  }

  const siteSlug = await resolveSiteSlug(request, client);
  if (!siteSlug) {
    return new Response("unknown host", {
      status: 404,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/plain; charset=utf-8",
        Vary: "Cookie, Host",
      },
    });
  }

  if (PUBLIC_PAGES.has(url.pathname)) return null;

  if (isEducationHubPathname(url.pathname)) {
    const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Host" };
    if (siteSlug !== DEFAULT_SITE_SLUG) return new Response("Not found", { status: 404, headers });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers });
    const slug = educationSlugFromPathname(url.pathname);
    if (!["/education", "/education/search"].includes(url.pathname)) {
      if (!slug) return new Response("Not found", { status: 404, headers });
      try {
        const canonical = (await publicPageForRequest(request, client, siteSlug, slug)) ??
          (await publicPageForRequest(request, client, siteSlug, `${slug}/index`)) ??
          (await publicPageForRequest(request, client, siteSlug,
            (await publicCanonicalSlugMap(client, siteSlug)).get(slug.toLowerCase()) ?? slug));
        if (!isPublicEducationPage(canonical)) return new Response("Education page not found", { status: 404, headers });
      } catch {
        return new Response("Education temporarily unavailable", { status: 503, headers });
      }
    }
    educationRequests.add(request);
    return null;
  }

  let gateConfig;
  try {
    gateConfig = await getRequestPasswordGateConfig(
      request,
      client,
      siteSlug,
    );
  } catch (error) {
    console.warn("[wiki-vite-server] password gate lookup failed", error);
    return new Response("password gate configuration unavailable", {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/plain; charset=utf-8",
        Vary: "Cookie, Host",
      },
    });
  }
  const isAuthed =
    await hasValidAuthCookie(request, client, siteSlug, gateConfig) ||
    isDianaPreviewTestAuth(request, siteSlug);
  const isLoginPage = isSignInPathname(url.pathname);

  if (isLoginPage && (isAuthed || !gateConfig.enabled)) {
    const redirect = safeLocalRedirect(url.searchParams.get("redirect"));
    return privateRedirect(request, redirect);
  }

  if (!gateConfig.enabled || isAuthed || isLoginPage) {
    return null;
  }

  if (siteSlug === DEFAULT_SITE_SLUG && (request.method === "GET" || request.method === "HEAD")) {
    if (url.pathname === "/search" && !isLinkPreviewRequest(request)) {
      educationRequests.add(request);
      return null;
    }
    if (isEducationPathname(url.pathname)) {
      const slug = slugFromPathname(url.pathname)!;
      try {
        const canonical = (await publicPageForRequest(request, client, siteSlug, slug)) ??
          (await publicPageForRequest(request, client, siteSlug, `${slug}/index`)) ??
          (await publicPageForRequest(request, client, siteSlug,
            (await publicCanonicalSlugMap(client, siteSlug)).get(slug.toLowerCase()) ?? slug));
        if (isPublicEducationPage(canonical)) {
          educationRequests.add(request);
          return null;
        }
      } catch {
        return new Response("Education temporarily unavailable", { status: 503,
          headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Host" } });
      }
    }
  }

  if (isLinkPreviewRequest(request) && !isAppAssetRequest(url.pathname)) {
    const { handleSharePreviewRequest } = await import("./api/share-preview.js");
    return handleSharePreviewRequest(sharePreviewRequestFor(request), client, siteSlug);
  }

  if (url.pathname === "/" && !url.searchParams.has("token") &&
      (request.method === "GET" || request.method === "HEAD")) {
    landingRequests.add(request);
    return null;
  }

  const clean = new URL(request.url);
  clean.searchParams.delete("token");
  const signInUrl = new URL("/sign-in", request.url);
  signInUrl.searchParams.set("redirect", `${clean.pathname}${clean.search}`);
  return privateRedirect(request, signInUrl.toString());
}


/**
 * The session and page answers for a signed-in document, from the API's own
 * handlers: the same route table, gate, session lookup, access checks and
 * redaction the reader's requests get, for this request's own headers.
 */
async function sessionDocumentPayload(request: Request, dispatch: ApiDispatch, url: URL, slug: string) {
  const headers = new Headers(request.headers);
  headers.set("accept", "application/json");
  headers.delete("if-none-match");
  const read = async (pathname: string) => {
    const response = await dispatch(new Request(new URL(pathname, url), { method: "GET", headers }));
    return response?.ok ? response.json() as Promise<unknown> : null;
  };
  const [session, pages] = await Promise.all([
    read("/api/wiki/session?scope=session"),
    read(`/api/wiki/pages?${new URLSearchParams({ scope: "session", slugs: slug })}`),
  ]);
  if (!session || !pages) return null;
  const identity = parseWikiSessionIdentity(session);
  // Exactly this route's page: an /index fallback or an unavailable stub is
  // left to the reader's own request.
  const page = parseWikiPageBatch(pages).pages.find(record => record.slug === slug);
  return identity.scope === "session" && identity.authenticated && page ? { identity, page } : null;
}

async function staticIndexHtml(
  request: Request,
  client: ConvexHttpClient,
  filePath: string,
  providedHtml?: string,
  dispatch?: ApiDispatch,
): Promise<string | StreamedDocument> {
  const html = providedHtml ?? await readFile(filePath, "utf8");
  const url = new URL(request.url);
  // An app route (chat, admin, ...) never renders a wiki page, so it has no
  // page metadata to look up and no navigation slice to inline.
  const slug = isReaderAppRoute(url.pathname) ? null : slugFromPathname(url.pathname);
  const tag = tagFromPathname(url.pathname);

  const siteSlug = await resolveSiteSlug(request, client);
  if (!siteSlug) return html;

  // The landing page carries no wiki page data, only its own share card.
  if (landingRequests.has(request)) {
    const landing = landingRouteMetadata();
    return injectHeadMetadata(html, {
      ...landing,
      openGraphImage: new URL(landing.openGraphImage!, request.url).toString(),
      noIndex: true,
    });
  }

  if (isEducationHubPathname(url.pathname)) {
    const page = slug ? await publicPageForRequest(request, client, siteSlug, slug) : null;
    const safePage = isPublicEducationPage(page) && page
      ? await redactPageContent(client, siteSlug, page, request) : null;
    const title = safePage?.title ?? (url.pathname === "/education/search" ? "Search education" : "Cancer science, made approachable");
    const description = safePage ? pageDescription(safePage, "Oncobase Education") : "Explore the Oncobase education library: cancer biology, immunotherapy, and the science behind treatment.";
    return injectHeadMetadata(html, { title: `${title} — Oncobase Education`, description,
      openGraphTitle: title, openGraphDescription: description, openGraphType: safePage ? "article" : "website",
      twitterTitle: title, twitterDescription: description,
      openGraphImage: safePage ? pageSocialImageUrl(request.url, url.pathname) : undefined,
      canonicalUrl: new URL(url.pathname, request.url).toString(), noIndex: false, sensitive: false });
  }

  // The normal gate has already run. A route hint only skips payload work;
  // it cannot authorize an API, select an account, or expose server content.
  if (!isLinkPreviewRequest(request) && readerShellHint(request.headers.get("cookie") ?? "", url)) {
    return html.replace("</head>", '<meta name="robots" content="noindex, nofollow" /></head>');
  }

  const [publicPage, gateEnabled, taggedPages] = await Promise.all([
    slug
      ? publicPageForRequest(request, client, siteSlug, slug)
      : Promise.resolve(null),
    getRequestPasswordGateConfig(request, client, siteSlug).then(
      (config) => config.enabled,
    ),
    tag
      ? getDocumentsByTag(client, withSiteSlug(siteSlug, { tag })).catch(() => null)
      : Promise.resolve(null),
  ]);
  let page = publicPage;
  if (!page && slug) {
    const sessionUser = await getSessionUser(request, client, siteSlug).catch(
      () => null,
    );
    if (sessionUser) {
      const sessionPage = await client.query(
        api.documents.getBySlug,
        withSiteSlug(siteSlug, { slug, includeSensitive: true }),
      ).catch(() => null);
      if (
        sessionPage &&
        (sessionPage.sensitive !== true ||
          (await canUserAccessSlug(
            client,
            siteSlug,
            sessionUser,
            sessionPage.slug,
          ).catch(() => false)))
      ) {
        page = sessionPage;
      }
    }
  }
  if (!page && !gateEnabled) return html;

  const siteName = siteSlug === DEFAULT_SITE_SLUG ? DIANA_SITE_NAME : siteSlug;
  const metadataPage = publicPage
    ? await redactPageContent(client, siteSlug, { ...publicPage, content: publicPage.content ?? "" }, request)
    : page;
  const routeMetadata = legacyRouteMetadata({
    page: metadataPage && { ...metadataPage, description: pageDescription(metadataPage, siteName) },
    pathname: url.pathname,
    siteName,
    slug,
    tagCount: taggedPages?.length,
  });

  const documentHtml = injectHeadMetadata(html, {
    ...routeMetadata,
    openGraphImage: routeMetadata.openGraphImage
      ? new URL(routeMetadata.openGraphImage, request.url).toString()
      : publicPage && routeMetadata.openGraphType === "article"
        ? pageSocialImageUrl(request.url, url.pathname) : undefined,
    canonicalUrl: gateEnabled || page?.sensitive === true
      ? undefined
      : new URL(url.pathname, request.url).toString(),
    noIndex: gateEnabled,
    sensitive: page?.sensitive === true,
  });
  const pageRoute = Boolean(slug) && !tag && url.pathname !== "/search" &&
    !specialRouteMetadata({ pathname: url.pathname, siteName, defaultDescription: "" });
  if (!pageRoute || !slug) return documentHtml;
  const education = educationRequests.has(request);
  // The tree's first paint, from the same public listing the canonical
  // redirects use. An education-only guest's API answers only lessons, so
  // that request gets no slice.
  const publicSlugs = education ? null : publicCanonicalSlugMap(client, siteSlug)
    .then(map => new Set(map.values())).catch(() => null);
  // Reuse the current metadata lookup and request-scoped redaction policy.
  // The ordinary CSR response supplies data without server-rendered article UI.
  const publicPayload = async () => {
    if (publicPage?.sensitive !== false || !publicPage.content) return null;
    try {
      const safePage = await redactPageContent(client, siteSlug, publicPage, request);
      // A gated document is always private/no-store. Only that fresh response
      // may tell an automatic reader it has no account session. Shared public
      // HTML must never select a later visitor's account scope.
      const publicSessionVerified = education || gateEnabled && await getSessionUser(request, client, siteSlug)
        .then(user => user === null).catch(() => false);
      const withPage = injectPageBootstrap("</body>", safePage, url, siteSlug, { publicSessionVerified,
        publicAccessPartition: education ? "education" : undefined });
      if (withPage === "</body>") return null;
      const slugs = await publicSlugs;
      const navigation = slugs ? navigationBootstrapScripts(navigationSlice(slugs, safePage.slug), url, siteSlug, { scope: "public" }) : null;
      return `${withPage.slice(0, -"</body>".length)}${navigation ?? ""}`;
    } catch {
      console.warn("[wiki-bootstrap] page data unavailable; using page API");
      return null;
    }
  };
  // A signed-in reader: its session identity and its page, as the API
  // answers this request. Scope is chosen by the session, never by a cache.
  // Those reads (the session's access set above all) and the slice's listing
  // take longer than the document itself, so the data blocks stream after the
  // rest of the document: its head (stylesheet, scripts, head requests) never
  // waits for them.
  const contentSlug = contentSlugFromRouteSlug(slugFromPath(url.pathname));
  const cut = documentHtml.lastIndexOf("</body>");
  if (cut < 0 || documentHtml.includes('id="wiki-page-bootstrap"')) return documentHtml;
  const streamed = (tail: Promise<string>): StreamedDocument => ({ head: documentHtml.slice(0, cut), tail, rest: documentHtml.slice(cut) });
  if (dispatch && !education && request.method === "GET" && url.searchParams.get("scope") !== "public" &&
      await getSessionUser(request, client, siteSlug).catch(() => null)) {
    documentPayloads.set(request, "session");
    return streamed((async () => {
      try {
        const payload = await sessionDocumentPayload(request, dispatch, url, contentSlug);
        const page = payload && sessionPageBootstrapScripts(payload.identity, payload.page, url, siteSlug);
        if (payload && page) {
          const slugs = await publicSlugs;
          return page + (slugs ? navigationBootstrapScripts(navigationSlice(slugs, payload.page.slug), url, siteSlug,
            { scope: "session", identity: payload.identity }) ?? "" : "");
        }
      } catch (error) {
        console.warn("[wiki-bootstrap] session page data unavailable; using page API", error);
      }
      // No session payload: the reader verifies its session through the API,
      // presenting the public page meanwhile when there is one.
      return await publicPayload() ?? "";
    })());
  }
  const publicReadable = publicPage?.sensitive === false && Boolean(publicPage.content);
  documentPayloads.set(request, publicReadable ? "public" : "none");
  return publicReadable ? streamed(publicPayload().then(fragment => fragment ?? "")) : documentHtml;
}

async function htmlHeaders(request: Request, client: ConvexHttpClient, filePath: string) {
  if (isEducationHubPathname(new URL(request.url).pathname)) {
    return { ...staticHeaders(filePath), "X-Wiki-Reader-Access": "education", "X-Wiki-Reader-Account": "public",
      "Cache-Control": "private, no-store", Vary: "Accept, Cookie, Host, User-Agent" };
  }
  const siteSlug = (await resolveSiteSlug(request, client)) ?? DEFAULT_SITE_SLUG;
  let gateConfig;
  try {
    gateConfig = await getRequestPasswordGateConfig(
      request,
      client,
      siteSlug,
    );
  } catch (error) {
    console.warn("[wiki-vite-server] password gate lookup failed", error);
    return {
      ...staticHeaders(filePath),
      "X-Wiki-Reader-Account": "unknown",
      "X-Wiki-Reader-Access": "unknown",
      "Cache-Control": "private, no-store",
      Vary: "Accept, Cookie, Host, User-Agent",
    };
  }
  const [authed, sessionUser] = await Promise.all([
    hasValidAuthCookie(request, client, siteSlug, gateConfig),
    getSessionUser(request, client, siteSlug).catch(() => undefined),
  ]);
  const privateResponse =
    sessionUser === undefined ||
    readerShellHint(request.headers.get("cookie") ?? "", new URL(request.url)) ||
    authed ||
    isDianaPreviewTestAuth(request, siteSlug) ||
    gateConfig.enabled ||
    Boolean(sessionUser);
  return {
    ...staticHeaders(filePath),
    "X-Wiki-Reader-Access": landingRequests.has(request)
      ? LANDING_READER_ACCESS
      : educationRequests.has(request) ? "education" : "wiki",
    "X-Wiki-Reader-Account": sessionUser === undefined ? "unknown" : sessionUser ? createHash("sha256").update(`${siteSlug}:${sessionUser._id}`).digest("hex") : "public",
    "Cache-Control": privateResponse
      ? "private, no-store"
      : "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    Vary: privateResponse
      ? "Accept, Cookie, Host, User-Agent"
      : "Accept, Host, User-Agent",
  };
}

async function robotsPolicyResponse(
  request: Request,
  client: ConvexHttpClient,
) {
  let allowIndexing = false;
  let allowEducation = false;
  try {
    const siteSlug = await resolveSiteSlug(request, client);
    if (siteSlug) {
      allowEducation = siteSlug === DEFAULT_SITE_SLUG;
      const gateConfig = await getRequestPasswordGateConfig(
        request,
        client,
        siteSlug,
      );
      allowIndexing = !gateConfig.enabled;
    }
  } catch (error) {
    console.warn("[wiki-vite-server] robots policy lookup failed", error);
  }

  // Crawlers ask for the sitemap regardless; name it wherever something is indexable.
  const sitemap = allowIndexing || allowEducation ? `Sitemap: ${new URL("/sitemap.xml", request.url).toString()}\n` : "";
  return new Response(
    `User-agent: *\n${allowIndexing ? "Allow" : "Disallow"}: /\n${!allowIndexing && allowEducation ? "Allow: /education\n" : ""}${sitemap}`,
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
        Vary: "Host",
      },
    },
  );
}

/**
 * The pages robots.txt lets a crawler index: every public page of an open site,
 * or only the public education library of a gated one. Slugs come from the
 * same public listing the canonical redirects use, so nothing sensitive or
 * gated can appear here.
 */
async function sitemapResponse(request: Request, client: ConvexHttpClient) {
  const failure = (status: number) => new Response(status === 404 ? "Not found" : "Sitemap temporarily unavailable", {
    status, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", Vary: "Host" } });
  try {
    const siteSlug = await resolveSiteSlug(request, client);
    if (!siteSlug) return failure(404);
    const gateConfig = await getRequestPasswordGateConfig(request, client, siteSlug);
    if (gateConfig.enabled && siteSlug !== DEFAULT_SITE_SLUG) return failure(404);
    const slugs = [...new Set((await publicCanonicalSlugMap(client, siteSlug)).values())].sort();
    const encode = (slug: string) => `/${slug.split("/").map(encodeURIComponent).join("/")}`;
    const paths = gateConfig.enabled
      ? ["/education", ...slugs.filter(isEducationSlug).map(educationHref)]
      : ["/", ...slugs.filter(slug => slug !== "index").map(encode)];
    const origin = new URL(request.url).origin;
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;").replace(/"/g, "&quot;");
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
        [...new Set(paths)].slice(0, 50_000).map(pathname => `  <url><loc>${escape(`${origin}${pathname}`)}</loc></url>`).join("\n")}\n</urlset>\n`,
      { headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/xml; charset=utf-8", Vary: "Host" } },
    );
  } catch (error) {
    console.warn("[wiki-vite-server] sitemap lookup failed", error);
    return failure(503);
  }
}

export function createAppShellHandler({
  client = createClient(),
  distDir,
  indexHtml,
  dispatch,
}: {
  client?: ConvexHttpClient;
  distDir: string;
  indexHtml?: string;
  /** Answers a signed-in document's own session and page reads in-process. */
  dispatch?: ApiDispatch;
}) {
  client = traceConvexClient(client);
  return async function handleAppShellRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      return robotsPolicyResponse(request, client);
    }
    if (url.pathname === "/sitemap.xml") {
      return sitemapResponse(request, client);
    }
    const directPath = safeStaticPath(distDir, url.pathname === "/" ? "/index.html" : url.pathname);
    if (directPath === null) {
      return new Response("Bad request", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" },
      });
    }
    const hasExtension = path.extname(url.pathname) !== "";
    const isMarkdownAlias = MARKDOWN_ALIAS_PATH_RE.test(url.pathname);
    // A directory that shares a route name (a /features folder) is not a file.
    const directFileExists = existsSync(directPath) && !directPath.endsWith(path.sep) && statSync(directPath).isFile();
    const filePath = directFileExists ? directPath : path.join(distDir, "index.html");

    const servesIndex = path.basename(filePath) === "index.html";
    if (!existsSync(filePath) && !(servesIndex && indexHtml !== undefined)) {
      return new Response("Vite build output not found. Run bun --cwd apps/app build first.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (!directFileExists && hasExtension && !isMarkdownAlias) {
      // Explicitly uncacheable. The platform applies the one-year immutable
      // header for /assets/* to any response that does not set its own, and a
      // browser must not remember for a year that a chunk was missing mid-deploy.
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    if (servesIndex) {
      const [html, headers] = await Promise.all([
        traceBackendPhase("shell.document", () => staticIndexHtml(request, client, filePath, indexHtml, dispatch)),
        traceBackendPhase("shell.headers", () => htmlHeaders(request, client, filePath)),
      ]);
      const { "X-Wiki-Reader-Account": accountTag, "X-Wiki-Reader-Access": readerAccess, ...responseHeaders } = headers;
      const streamed = typeof html === "string" ? null : html;
      const documentStart = streamed ? streamed.head : html as string;
      // Also on <html>: the inline preload script at the top of the head runs
      // before these metas are parsed and must not fetch the reader for a
      // document that will not start it (the landing page).
      // The server's own routing decision for the head script: whether this
      // document starts the reader, and what page data it already carries.
      const startsReader = rootRouteFor(url.pathname, readerAccess === "education", readerAccess === LANDING_READER_ACCESS) === "reader";
      const payload = documentPayloads.get(request);
      const stamps = `data-reader-access="${readerAccess}" data-reader-start="${startsReader}"${payload ? ` data-reader-payload="${payload}"` : ""}`;
      const accountHtml = documentStart.replace(/<html(?=[\s>])/, `<html ${stamps}`)
        .replace("</head>", `<meta name="wiki-reader-account" content="${accountTag}" /><meta name="wiki-reader-access" content="${readerAccess}" /></head>`);
      if (!streamed) return new Response(accountHtml, { headers: responseHeaders });
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(accountHtml));
          controller.enqueue(encoder.encode(`${await streamed.tail}${streamed.rest}`));
          controller.close();
        },
      });
      return new Response(body, { headers: responseHeaders });
    }

    return new Response(await readFile(filePath), {
      headers: staticHeaders(filePath),
    });
  };
}

export function createWikiViteHandler({
  client = createClient(),
  distDir,
  indexHtml,
}: {
  client?: ConvexHttpClient;
  distDir: string;
  indexHtml?: string;
}) {
  // The HTML path is the most frequent origin request; without this its
  // Convex RPCs are invisible in traces.
  client = traceConvexClient(client);
  // The full API router includes chat, archives and other optional features.
  // HTML requests use the same shared access helpers without initializing it.
  let apiHandler: Promise<ReturnType<typeof import("./wiki-api.js").createWikiApiHandler>> | undefined;
  const dispatch: ApiDispatch = async (request) => {
    apiHandler ??= import("./wiki-api.js").then(({ createWikiApiHandler }) => createWikiApiHandler(client));
    return (await apiHandler)(request);
  };
  const handleAppShellRequest = createAppShellHandler({ client, distDir, indexHtml, dispatch });

  return async function handleWikiViteRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const pathClass = shellPathClass(pathname);
    // Most 404s are scanners asking for dot files and WordPress paths. Answer
    // before the gate so they cost no site or database lookup.
    const response = isProbePath(pathname) ? probeResponse() : await respond(request);
    traceBackendAttributes({ "shell.path_class": pathClass, "shell.outcome": shellOutcome(response.status, pathClass, response.headers.get("content-type")) });
    return response;
  };

  async function respond(request: Request): Promise<Response> {
    const started = performance.now();
    const { pathname } = new URL(request.url);
    // oncobase.io is a separate, public site on the same deployment: no gate, session, or database.
    if (isMarketingRequest(request)) return handleMarketingRequest(request, { distDir, indexHtml });
    const moved = movedToMarketingSite(request);
    if (moved) return moved;
    if (isInternalReaderPath(pathname)) return internalReaderNotFound();
    if (pathname.startsWith("/api/")) {
      const apiResponse = await dispatch(request);
      if (apiResponse) return apiResponse;
    }
    const trailingSlashRedirect = trailingSlashRedirectResponse(request);
    if (trailingSlashRedirect) return trailingSlashRedirect;
    // A shared reader shell contains no page metadata, bootstrap or account
    // state. Its fragment capability is checked by the dedicated read API.
    if (pathname === "/share") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      if (!await resolveSiteSlug(request, client)) return new Response("Not found", { status: 404 });
      const { SHARE_HEADERS } = await import("./api/page-shares");
      const html = indexHtml ?? await readFile(path.join(distDir, "index.html"), "utf8");
      const safeHtml = injectHeadMetadata(html, { title: "Shared page", description: "A privately shared page.", noIndex: true });
      return new Response(request.method === "HEAD" ? null : safeHtml, { headers: {
        ...SHARE_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
    }
    const gateResponse = await traceBackendPhase("shell.gate", () => enforcePasswordGate(request, client));
    if (gateResponse) return gateResponse;
    const redirectResponse = legacyRedirectResponse(request);
    if (redirectResponse) return redirectResponse;
    const explicitCanonicalRedirect = explicitCanonicalRedirectResponse(request);
    if (explicitCanonicalRedirect) return explicitCanonicalRedirect;
    const canonicalRedirect = await traceBackendPhase("shell.canonical", () => canonicalSlugRedirectResponse(request, client));
    if (canonicalRedirect) return canonicalRedirect;
    const response = await handleAppShellRequest(request);
    response.headers.append("Server-Timing", `wiki-shell;dur=${(performance.now() - started).toFixed(1)}`);
    return response;
  }
}

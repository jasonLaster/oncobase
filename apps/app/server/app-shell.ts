import { createHash } from "node:crypto";
import { readerShellHint } from "../src/bootstrap/reader-shell-hint";
import { landingRouteMetadata, specialRouteMetadata } from "../src/special-route-metadata";
import { LANDING_READER_ACCESS } from "../src/root-route";
import { injectPageBootstrap } from "./page-bootstrap";
import { injectHeadMetadata } from "./html-head";
import { safeStaticPath, staticHeaders } from "./static-files";
import { handleMarketingRequest, isMarketingRequest, movedToMarketingSite } from "./marketing-site";
import { traceBackendCache, traceBackendPhase, traceConvexClient } from "./backend-tracing";
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
import { isEducationPathname } from "../src/education-access";
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

type CanonicalSlugCacheEntry = {
  expires: number;
  map: Map<string, string>;
};

type ManifestPageResult = {
  page: Array<{ slug?: unknown }>;
  isDone: boolean;
  continueCursor: string | null;
};

const canonicalSlugCache = new Map<string, CanonicalSlugCacheEntry>();
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
  return pathname.startsWith("/assets/") || pathname === "/favicon.ico" || ASSET_PATH_RE.test(pathname);
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

async function publicCanonicalSlugMap(client: ConvexHttpClient, siteSlug: string) {
  const now = Date.now();
  const cached = canonicalSlugCache.get(siteSlug);
  traceBackendCache("canonical-slugs", Boolean(cached && cached.expires > now));
  if (cached && cached.expires > now) return cached.map;

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

  const map = canonicalSlugMap(slugs);
  canonicalSlugCache.set(siteSlug, {
    expires: now + CANONICAL_SLUG_CACHE_TTL_MS,
    map,
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


async function staticIndexHtml(
  request: Request,
  client: ConvexHttpClient,
  filePath: string,
  providedHtml?: string,
) {
  const html = providedHtml ?? await readFile(filePath, "utf8");
  const url = new URL(request.url);
  const slug = slugFromPathname(url.pathname);
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
    const description = safePage?.description || "Explore the Oncobase education library: cancer biology, immunotherapy, and the science behind treatment.";
    return injectHeadMetadata(html, { title: `${title} — Oncobase Education`, description,
      openGraphTitle: title, openGraphDescription: description, openGraphType: safePage ? "article" : "website",
      twitterTitle: title, twitterDescription: description,
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
  const routeMetadata = legacyRouteMetadata({
    page,
    pathname: url.pathname,
    siteName,
    slug,
    tagCount: taggedPages?.length,
  });

  const documentHtml = injectHeadMetadata(html, {
    ...routeMetadata,
    openGraphImage: routeMetadata.openGraphImage
      ? new URL(routeMetadata.openGraphImage, request.url).toString()
      : undefined,
    canonicalUrl: gateEnabled || page?.sensitive === true
      ? undefined
      : new URL(url.pathname, request.url).toString(),
    noIndex: gateEnabled,
    sensitive: page?.sensitive === true,
  });
  // Reuse the current metadata lookup and request-scoped redaction policy.
  // The ordinary CSR response supplies data without server-rendered article UI.
  if (publicPage?.sensitive === false && publicPage.content && slug && !tag &&
      url.pathname !== "/search" && !specialRouteMetadata({ pathname: url.pathname, siteName, defaultDescription: "" })) {
    try {
      const safePage = await redactPageContent(client, siteSlug, publicPage, request);
      // A gated document is always private/no-store. Only that fresh response
      // may tell an automatic reader it has no account session. Shared public
      // HTML must never select a later visitor's account scope.
      const publicSessionVerified = educationRequests.has(request) || gateEnabled && await getSessionUser(request, client, siteSlug)
        .then(user => user === null).catch(() => false);
      return injectPageBootstrap(documentHtml, safePage, url, siteSlug, { publicSessionVerified,
        publicAccessPartition: educationRequests.has(request) ? "education" : undefined });
    } catch {
      console.warn("[wiki-bootstrap] page data unavailable; using page API");
    }
  }
  return documentHtml;
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

  return new Response(
    `User-agent: *\n${allowIndexing ? "Allow" : "Disallow"}: /\n${!allowIndexing && allowEducation ? "Allow: /education\n" : ""}`,
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/plain; charset=utf-8",
        Vary: "Host",
      },
    },
  );
}

export function createAppShellHandler({
  client = createClient(),
  distDir,
  indexHtml,
}: {
  client?: ConvexHttpClient;
  distDir: string;
  indexHtml?: string;
}) {
  client = traceConvexClient(client);
  return async function handleAppShellRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      return robotsPolicyResponse(request, client);
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
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (servesIndex) {
      const [html, headers] = await Promise.all([
        traceBackendPhase("shell.document", () => staticIndexHtml(request, client, filePath, indexHtml)),
        traceBackendPhase("shell.headers", () => htmlHeaders(request, client, filePath)),
      ]);
      const { "X-Wiki-Reader-Account": accountTag, "X-Wiki-Reader-Access": readerAccess, ...responseHeaders } = headers;
      const accountHtml = html.replace("</head>", `<meta name="wiki-reader-account" content="${accountTag}" /><meta name="wiki-reader-access" content="${readerAccess}" /></head>`);
      return new Response(accountHtml, { headers: responseHeaders });
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
  const handleAppShellRequest = createAppShellHandler({ client, distDir, indexHtml });

  return async function handleWikiViteRequest(request: Request): Promise<Response> {
    const started = performance.now();
    const { pathname } = new URL(request.url);
    // oncobase.io is a separate, public site on the same deployment: no gate, session, or database.
    if (isMarketingRequest(request)) return handleMarketingRequest(request, { distDir, indexHtml });
    const moved = movedToMarketingSite(request);
    if (moved) return moved;
    if (isInternalReaderPath(pathname)) return internalReaderNotFound();
    if (pathname.startsWith("/api/")) {
      apiHandler ??= import("./wiki-api.js").then(({ createWikiApiHandler }) => createWikiApiHandler(client));
      const apiResponse = await (await apiHandler)(request);
      if (apiResponse) return apiResponse;
    }
    const trailingSlashRedirect = trailingSlashRedirectResponse(request);
    if (trailingSlashRedirect) return trailingSlashRedirect;
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
  };
}

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../apps/web/convex/_generated/api.js";
import { isLinkPreviewBotUserAgent } from "@oncobase/wiki-content/link-preview";
import { legacyRedirectResponse } from "./redirects.ts";
import {
  canonicalSlugMap,
  canonicalSlugPathname,
  explicitCanonicalPathname,
  slugFromRoutePathname,
  trailingSlashCanonicalPathname,
} from "../src/route-canonicalization.ts";
import {
  canUserAccessSlug,
  createClient,
  createWikiApiHandler,
  getSessionUser,
  getRequestPasswordGateConfig,
  hasValidAuthCookie,
  handleSharePreviewRequest,
  isDianaPreviewTestAuth,
  resolveSiteSlug,
  withSiteSlug,
} from "./wiki-api.js";
import {
  DEFAULT_SITE_DESCRIPTION,
  DIANA_SITE_NAME,
  legacyRouteMetadata,
  tagFromPathname,
} from "./legacy-route-metadata.js";
import { safeLocalRedirect } from "../src/safe-redirect.js";

const DEFAULT_SITE_SLUG = "diana";
const CANONICAL_SLUG_CACHE_TTL_MS = 60_000;
const CANONICAL_SLUG_PAGE_SIZE = 512;
const ASSET_PATH_RE = /\.(css|js|json|png|jpg|jpeg|gif|webp|svg|ico|wasm|txt|xml|map)$/i;
const MARKDOWN_ALIAS_PATH_RE = /\.(?:md|mdx)$/i;
const PUBLIC_PAGES = new Set(["/terms-and-conditions"]);

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

const STATIC_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function staticHeaders(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    "Content-Type": STATIC_MIME_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
}

function safeStaticPath(distDir: string, pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(distDir, normalized);
}

function slugFromPathname(pathname: string) {
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
  if (url.pathname === "/login" || url.pathname.startsWith("/api/") || isAppAssetRequest(url.pathname)) {
    return null;
  }

  const slug = slugFromPathname(url.pathname);
  if (!slug || slug === "index") return null;

  const siteSlug = await resolveSiteSlug(request, client);
  if (!siteSlug) return null;

  try {
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
  const isLoginPage = url.pathname === "/login";

  if (isLoginPage && (isAuthed || !gateConfig.enabled)) {
    const redirect = safeLocalRedirect(url.searchParams.get("redirect"));
    return privateRedirect(request, redirect);
  }

  if (!gateConfig.enabled || isAuthed || isLoginPage) {
    return null;
  }

  if (isLinkPreviewRequest(request) && !isAppAssetRequest(url.pathname)) {
    return handleSharePreviewRequest(sharePreviewRequestFor(request), client, siteSlug);
  }

  const clean = new URL(request.url);
  clean.searchParams.delete("token");
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", `${clean.pathname}${clean.search}`);
  return privateRedirect(request, loginUrl.toString());
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectHeadMetadata(
  html: string,
  metadata: {
    title: string;
    description?: string | null;
    canonicalUrl?: string;
    noIndex?: boolean;
    openGraphDescription?: string;
    openGraphTitle?: string;
    openGraphType?: "article" | "website";
    sensitive?: boolean;
    twitterDescription?: string;
    twitterTitle?: string;
  },
) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description || metadata.title);
  const openGraphTitle = escapeHtml(metadata.openGraphTitle ?? metadata.title);
  const openGraphDescription = escapeHtml(
    metadata.openGraphDescription ?? metadata.description ?? metadata.title,
  );
  const twitterTitle = escapeHtml(metadata.twitterTitle ?? metadata.title);
  const twitterDescription = escapeHtml(
    metadata.twitterDescription ?? metadata.description ?? metadata.title,
  );
  const canonicalUrl = metadata.canonicalUrl
    ? escapeHtml(metadata.canonicalUrl)
    : null;
  const robotsContent =
    metadata.noIndex || metadata.sensitive ? "noindex, nofollow" : "index, follow";
  const tags = [
    canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}" />` : null,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${robotsContent}" />`,
    `<meta property="og:title" content="${openGraphTitle}" />`,
    `<meta property="og:description" content="${openGraphDescription}" />`,
    canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}" />` : null,
    metadata.openGraphType
      ? `<meta property="og:type" content="${metadata.openGraphType}" />`
      : null,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${twitterTitle}" />`,
    `<meta name="twitter:description" content="${twitterDescription}" />`,
  ]
    .filter((tag): tag is string => tag !== null)
    .join("\n    ");

  return html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `    ${tags}\n  </head>`);
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

  const [publicPage, gateEnabled, taggedPages] = await Promise.all([
    slug
      ? client.query(
          api.documents.getBySlug,
          withSiteSlug(siteSlug, { slug }),
        )
      : Promise.resolve(null),
    getRequestPasswordGateConfig(request, client, siteSlug).then(
      (config) => config.enabled,
    ),
    tag
      ? client
          .action(
            api.documents.getByTag,
            withSiteSlug(siteSlug, { tag }),
          )
          .catch(() => null)
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

  return injectHeadMetadata(html, {
    ...routeMetadata,
    canonicalUrl: gateEnabled || page?.sensitive === true
      ? undefined
      : new URL(url.pathname, request.url).toString(),
    noIndex: gateEnabled,
    sensitive: page?.sensitive === true,
  });
}

async function htmlHeaders(request: Request, client: ConvexHttpClient, filePath: string) {
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
      "Cache-Control": "private, no-store",
      Vary: "Accept, Cookie, Host, User-Agent",
    };
  }
  const [authed, sessionUser] = await Promise.all([
    hasValidAuthCookie(request, client, siteSlug, gateConfig),
    getSessionUser(request, client, siteSlug).catch(() => null),
  ]);
  const privateResponse =
    authed ||
    isDianaPreviewTestAuth(request, siteSlug) ||
    gateConfig.enabled ||
    Boolean(sessionUser);
  return {
    ...staticHeaders(filePath),
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
  try {
    const siteSlug = await resolveSiteSlug(request, client);
    if (siteSlug) {
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
    `User-agent: *\n${allowIndexing ? "Allow" : "Disallow"}: /\n`,
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
  return async function handleAppShellRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") {
      return robotsPolicyResponse(request, client);
    }
    const directPath = safeStaticPath(distDir, url.pathname === "/" ? "/index.html" : url.pathname);
    const hasExtension = path.extname(url.pathname) !== "";
    const isMarkdownAlias = MARKDOWN_ALIAS_PATH_RE.test(url.pathname);
    const directFileExists = existsSync(directPath) && !directPath.endsWith(path.sep);
    const filePath = directFileExists ? directPath : path.join(distDir, "index.html");

    const servesIndex = path.basename(filePath) === "index.html";
    if (!existsSync(filePath) && !(servesIndex && indexHtml !== undefined)) {
      return new Response("Vite build output not found. Run bun --cwd apps/wiki-vite build first.", {
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
      return new Response(await staticIndexHtml(request, client, filePath, indexHtml), {
        headers: await htmlHeaders(request, client, filePath),
      });
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
  const handleWikiApiRequest = createWikiApiHandler(client);
  const handleAppShellRequest = createAppShellHandler({ client, distDir, indexHtml });

  return async function handleWikiViteRequest(request: Request): Promise<Response> {
    const apiResponse = await handleWikiApiRequest(request);
    if (apiResponse) return apiResponse;
    const gateResponse = await enforcePasswordGate(request, client);
    if (gateResponse) return gateResponse;
    const redirectResponse = legacyRedirectResponse(request);
    if (redirectResponse) return redirectResponse;
    const trailingSlashRedirect = trailingSlashRedirectResponse(request);
    if (trailingSlashRedirect) return trailingSlashRedirect;
    const explicitCanonicalRedirect = explicitCanonicalRedirectResponse(request);
    if (explicitCanonicalRedirect) return explicitCanonicalRedirect;
    const canonicalRedirect = await canonicalSlugRedirectResponse(request, client);
    if (canonicalRedirect) return canonicalRedirect;
    return handleAppShellRequest(request);
  };
}

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../../../web/convex/_generated/api.js";
import {
  authedCookieName,
  createClient,
  createWikiApiHandler,
  resolveSiteSlug,
  withSiteSlug,
} from "./wiki-api.js";

const DEFAULT_SITE_SLUG = "diana";
const PASSWORD_GATE_CACHE_TTL_MS = 15_000;
const ASSET_PATH_RE = /\.(css|js|json|png|jpg|jpeg|gif|webp|svg|ico|wasm|txt|xml|map)$/i;
const LINK_PREVIEW_BOT_RE =
  /\b(slackbot|twitterbot|facebookexternalhit|linkedinbot|discordbot|whatsapp|telegrambot|skypeuripreview|googlebot|bingbot|applebot)\b/i;

type PasswordGateEntry = {
  enabled: boolean;
  expires: number;
};

const passwordGateCache = new Map<string, PasswordGateEntry>();

const STATIC_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
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
  if (pathname === "/login") return null;
  const decoded = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\.md$/, "");
  return decoded || "index";
}

function hasAuthCookie(request: Request, siteSlug: string) {
  const cookieName = authedCookieName(siteSlug);
  return (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .some((part) => part === `${cookieName}=true`);
}

function isAppAssetRequest(pathname: string) {
  return pathname.startsWith("/assets/") || pathname === "/favicon.ico" || ASSET_PATH_RE.test(pathname);
}

function isLinkPreviewRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const accept = request.headers.get("accept") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";
  return accept.includes("text/html") && LINK_PREVIEW_BOT_RE.test(userAgent);
}

async function isPasswordGateEnabled(client: ConvexHttpClient, siteSlug: string) {
  const now = Date.now();
  const cached = passwordGateCache.get(siteSlug);
  if (cached && cached.expires > now) return cached.enabled;

  let enabled = siteSlug === DEFAULT_SITE_SLUG;
  try {
    const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
    enabled = site?.config?.passwordGate ?? enabled;
  } catch (error) {
    console.warn("[wiki-vite-server] password gate lookup failed", error);
  }

  passwordGateCache.set(siteSlug, {
    enabled,
    expires: now + PASSWORD_GATE_CACHE_TTL_MS,
  });
  return enabled;
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
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const gateEnabled = await isPasswordGateEnabled(client, siteSlug);
  const isAuthed = hasAuthCookie(request, siteSlug);
  const isLoginPage = url.pathname === "/login";

  if (isLoginPage && (isAuthed || !gateEnabled)) {
    const redirect = url.searchParams.get("redirect") || "/";
    return Response.redirect(new URL(redirect, request.url), 302);
  }

  if (!gateEnabled || isAuthed || isLoginPage) {
    return null;
  }

  const token = url.searchParams.get("token");
  if (token) {
    const clean = new URL(request.url);
    clean.searchParams.delete("token");
    const loginUrl = new URL("/api/login", request.url);
    loginUrl.searchParams.set("token", token);
    loginUrl.searchParams.set("redirect", `${clean.pathname}${clean.search}`);
    return Response.redirect(loginUrl, 302);
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", `${url.pathname}${url.search}`);
  return Response.redirect(loginUrl, 302);
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
    canonicalUrl: string;
    sensitive?: boolean;
  },
) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description || metadata.title);
  const canonicalUrl = escapeHtml(metadata.canonicalUrl);
  const robotsContent = metadata.sensitive ? "noindex, nofollow" : "index, follow";
  const tags = [
    `<link rel="canonical" href="${canonicalUrl}" />`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${robotsContent}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${canonicalUrl}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
  ].join("\n    ");

  return html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `    ${tags}\n  </head>`);
}

async function staticIndexHtml(
  request: Request,
  client: ConvexHttpClient,
  filePath: string,
) {
  const html = await readFile(filePath, "utf8");
  const url = new URL(request.url);
  const slug = slugFromPathname(url.pathname);
  if (!slug) return html;

  const siteSlug = await resolveSiteSlug(request, client);
  if (!siteSlug) return html;

  const page = await client.query(
    api.documents.getBySlug,
    withSiteSlug(siteSlug, { slug }),
  );
  if (!page) return html;

  return injectHeadMetadata(html, {
    title: page.title,
    description: page.description,
    canonicalUrl: new URL(url.pathname, request.url).toString(),
    sensitive: page.sensitive === true,
  });
}

async function htmlHeaders(request: Request, client: ConvexHttpClient, filePath: string) {
  const siteSlug = (await resolveSiteSlug(request, client)) ?? DEFAULT_SITE_SLUG;
  const authed = hasAuthCookie(request, siteSlug);
  return {
    ...staticHeaders(filePath),
    "Cache-Control": authed
      ? "private, no-store"
      : "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
    Vary: authed ? "Accept, Cookie, Host, User-Agent" : "Accept, Host, User-Agent",
  };
}

export function createAppShellHandler({
  client = createClient(),
  distDir,
}: {
  client?: ConvexHttpClient;
  distDir: string;
}) {
  return async function handleAppShellRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const directPath = safeStaticPath(distDir, url.pathname === "/" ? "/index.html" : url.pathname);
    const hasExtension = path.extname(url.pathname) !== "";
    const directFileExists = existsSync(directPath) && !directPath.endsWith(path.sep);
    const filePath = directFileExists ? directPath : path.join(distDir, "index.html");

    if (!existsSync(filePath)) {
      return new Response("Vite build output not found. Run bun --cwd apps/wiki-vite build first.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (!directFileExists && hasExtension) {
      return new Response("Not found", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (path.basename(filePath) === "index.html") {
      return new Response(await staticIndexHtml(request, client, filePath), {
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
}: {
  client?: ConvexHttpClient;
  distDir: string;
}) {
  const handleWikiApiRequest = createWikiApiHandler(client);
  const handleAppShellRequest = createAppShellHandler({ client, distDir });

  return async function handleWikiViteRequest(request: Request): Promise<Response> {
    const apiResponse = await handleWikiApiRequest(request);
    if (apiResponse) return apiResponse;
    const pathname = new URL(request.url).pathname;
    if (isLinkPreviewRequest(request) && !isAppAssetRequest(pathname)) {
      return handleAppShellRequest(request);
    }
    const gateResponse = await enforcePasswordGate(request, client);
    if (gateResponse) return gateResponse;
    return handleAppShellRequest(request);
  };
}

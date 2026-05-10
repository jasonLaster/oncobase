import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../../../web/convex/_generated/api.js";
import {
  authedCookieName,
  createClient,
  createWikiApiHandler,
  resolveSiteSlug,
  withSiteSlug,
} from "./wiki-api";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 62003);
const client = createClient();
const handleWikiApiRequest = createWikiApiHandler(client);
const DEFAULT_SITE_SLUG = "diana";
const PASSWORD_GATE_CACHE_TTL_MS = 15_000;
const ASSET_PATH_RE = /\.(css|js|json|png|jpg|jpeg|gif|webp|svg|ico|wasm|txt|xml|map)$/i;

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

function safeStaticPath(pathname: string) {
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

async function isPasswordGateEnabled(siteSlug: string) {
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

async function enforcePasswordGate(request: Request) {
  const url = new URL(request.url);
  if (
    url.pathname.startsWith("/api/") ||
    isAppAssetRequest(url.pathname)
  ) {
    return null;
  }

  const siteSlug = await resolveSiteSlug(request, client);
  if (!siteSlug) {
    return new Response("unknown host", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const gateEnabled = await isPasswordGateEnabled(siteSlug);
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
  metadata: { title: string; description?: string | null },
) {
  const title = escapeHtml(metadata.title);
  const description = escapeHtml(metadata.description || metadata.title);
  const tags = [
    `<meta name="description" content="${description}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
  ].join("\n    ");

  return html
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `    ${tags}\n  </head>`);
}

async function staticIndexHtml(request: Request, filePath: string) {
  const html = await Bun.file(filePath).text();
  const slug = slugFromPathname(new URL(request.url).pathname);
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
  });
}

async function serveStatic(request: Request) {
  const url = new URL(request.url);
  const directPath = safeStaticPath(url.pathname === "/" ? "/index.html" : url.pathname);
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
    return new Response(await staticIndexHtml(request, filePath), {
      headers: staticHeaders(filePath),
    });
  }

  return new Response(Bun.file(filePath), {
    headers: staticHeaders(filePath),
  });
}

Bun.serve({
  port,
  async fetch(request) {
    try {
      const apiResponse = await handleWikiApiRequest(request);
      if (apiResponse) return apiResponse;
      const gateResponse = await enforcePasswordGate(request);
      if (gateResponse) return gateResponse;
      return await serveStatic(request);
    } catch (error) {
      console.error("[wiki-vite-server]", error);
      return Response.json({ error: "Wiki Vite server failed" }, { status: 500 });
    }
  },
});

console.log(`Wiki Vite server listening on http://127.0.0.1:${port}`);

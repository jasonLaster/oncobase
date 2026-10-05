import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isOncobaseHost, siteOrigin } from "../src/site-host";
import {
  compareRouteMetadata,
  featuresRouteMetadata,
  oncobaseHomeRouteMetadata,
  type SpecialRouteMetadata,
} from "../src/special-route-metadata";
import { injectHeadMetadata } from "./html-head";
import { safeStaticPath, staticHeaders } from "./static-files";

/**
 * oncobase.io is the Oncobase marketing site: a home page, features, and compare, with no wiki, no
 * sign-in, and no API. It shares a deployment with Diana's knowledge base and answers by host, so
 * this handler runs before the password gate, the reader session, and the database are involved.
 */
const PAGES: Record<string, () => SpecialRouteMetadata> = {
  "/": oncobaseHomeRouteMetadata,
  "/features": featuresRouteMetadata,
  "/compare": compareRouteMetadata,
};

/** Preview aliases that should serve the marketing site, from ONCOBASE_SITE_HOSTS (comma separated). */
function extraHosts() {
  return (process.env.ONCOBASE_SITE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function requestHost(request: Request) {
  return request.headers.get("host") ?? new URL(request.url).host;
}

export function isMarketingRequest(request: Request) {
  return isOncobaseHost(requestHost(request), extraHosts());
}

const MOVED_PATHS = new Set(["/features", "/compare", "/features.md", "/compare.md"]);

/** On Diana's site, the Oncobase pages (and their markdown twins) that used to live there now live on oncobase.io. */
export function movedToMarketingSite(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (!MOVED_PATHS.has(url.pathname)) return null;
  const origin = siteOrigin("oncobase", { protocol: url.protocol, hostname: url.hostname, port: url.port });
  return new Response(null, {
    status: 301,
    headers: {
      // Short cache so the move can be reversed quickly.
      "Cache-Control": "public, max-age=300",
      Location: `${origin}${url.pathname}${url.search}`,
      Vary: "Host",
    },
  });
}

const text = (body: string, init: ResponseInit & { headers?: Record<string, string> } = {}) =>
  new Response(body, {
    ...init,
    headers: { "Content-Type": "text/plain; charset=utf-8", Vary: "Host", ...init.headers },
  });

export async function handleMarketingRequest(
  request: Request,
  { distDir, indexHtml }: { distDir: string; indexHtml?: string },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", Vary: "Host" } });
  }
  const url = new URL(request.url);

  if (url.pathname === "/robots.txt") {
    return text(`User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap.xml\n`, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }
  if (url.pathname === "/sitemap.xml") {
    const urls = Object.keys(PAGES).map((page) => `  <url><loc>${url.origin}${page === "/" ? "/" : page}</loc></url>`);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", Vary: "Host" } },
    );
  }
  // There is no API here: no wiki, no sign-in, no telemetry.
  if (url.pathname.startsWith("/api/")) return text("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const page = PAGES[url.pathname];
  if (page) {
    const indexPath = path.join(distDir, "index.html");
    const html = indexHtml ?? (await readFile(indexPath, "utf8"));
    const metadata = page();
    const withHead = injectHeadMetadata(html, {
      ...metadata,
      openGraphImage: new URL(metadata.openGraphImage!, request.url).toString(),
      canonicalUrl: `${url.origin}${url.pathname}`,
      noIndex: false,
    });
    const body = withHead.replace(
      "</head>",
      '<meta name="wiki-site" content="oncobase" /><meta name="wiki-reader-account" content="public" /><meta name="wiki-reader-access" content="public" /></head>',
    );
    return new Response(body, {
      headers: { ...staticHeaders(indexPath), "Cache-Control": "public, max-age=0, must-revalidate", Vary: "Host" },
    });
  }

  // Built files (scripts, styles, images, and the markdown and text files for agents).
  const filePath = safeStaticPath(distDir, url.pathname);
  if (filePath === null) return text("Bad request", { status: 400 });
  if (path.basename(filePath) !== "index.html" && existsSync(filePath) && statSync(filePath).isFile()) {
    return new Response(await readFile(filePath), { headers: { ...staticHeaders(filePath), Vary: "Host" } });
  }
  return text("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

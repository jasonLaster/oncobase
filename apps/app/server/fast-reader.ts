import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { verifyWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { applyPiiRedactions, parseSitePiiPatterns } from "@oncobase/wiki-content/pii";
import { isLinkPreviewBotUserAgent } from "@oncobase/wiki-content/link-preview";
import { configuredRedirect, explicitCanonicalPathname, slugFromRoutePathname, trailingSlashCanonicalPathname } from "../src/route-canonicalization";
import { specialRouteMetadata } from "../src/special-route-metadata";
import { injectHeadMetadata } from "./html-head";
import { DEFAULT_SITE_DESCRIPTION, DIANA_SITE_NAME, legacyRouteMetadata } from "./legacy-route-metadata";
import { injectHtmlFirstPage } from "./html-first-experiment";

export function createFastReader({ indexHtml, criticalCss, client = new ConvexHttpClient(resolveServerConvexUrl()) }: {
  indexHtml: string; criticalCss: string; client?: ConvexHttpClient;
}) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if ((request.method !== "GET" && request.method !== "HEAD") || url.searchParams.get("html-first") === "off" ||
      /^\/(?:api|assets|tags|admin|tools|diagnostics|chat)(?:\/|$)/.test(pathname) ||
      ["/login", "/search", "/robots.txt", "/favicon.svg"].includes(pathname) ||
      /\.(?!mdx?$)[a-z0-9]+$/i.test(pathname) ||
      trailingSlashCanonicalPathname(pathname) || explicitCanonicalPathname(pathname) || configuredRedirect(pathname) ||
      isLinkPreviewBotUserAgent(request.headers.get("user-agent")) ||
      specialRouteMetadata({ pathname, siteName: DIANA_SITE_NAME, defaultDescription: DEFAULT_SITE_DESCRIPTION })) return null;
    const started = performance.now();
    const slug = slugFromRoutePathname(pathname);
    if (!slug) return null;
    // There is no TTL or stale authorization cache here. The query reads the
    // active host, gate policy, redaction policy and document consistently.
    const snapshot = await client.query(api.documents.getReaderPage, {
      host: url.hostname, slug,
      ...(url.hostname.endsWith(".vercel.app") && process.env.WIKI_SITE_SLUG
        ? { previewSiteSlug: process.env.WIKI_SITE_SLUG } : {}),
    });
    if (!snapshot) return null;
    const { siteSlug, gate } = snapshot;
    const headers = { "Cache-Control": "private, no-store", Vary: "Accept, Cookie, Host, User-Agent", "Content-Type": "text/html; charset=utf-8" };
    const cookieName = siteSlug === "diana" ? "authed" : `authed_${siteSlug}`;
    const token = (request.headers.get("cookie") ?? "").split(/;\s*/)
      .find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    if (gate.enabled && !await verifyWikiGateSession({ siteSlug, token,
      secret: process.env.WIKI_GATE_SESSION_SECRET?.trim(),
      gateVersion: JSON.stringify([gate.enabled, gate.passwordHash ||
        (siteSlug === "diana" ? process.env.DIANA_WIKI_PASSWORD_HASH?.trim() : null) || "passwordless"]),
    })) {
      url.searchParams.delete("token");
      const login = new URL("/login", url);
      login.searchParams.set("redirect", url.pathname + url.search);
      return new Response(null, { status: 302, headers: { ...headers, Location: login.toString() } });
    }
    const lookupMs = performance.now() - started;
    if (!snapshot.page?.contentHash || snapshot.page.sensitive !== false || !snapshot.page.content) return null;
    const configured = parseSitePiiPatterns(snapshot.piiPatterns);
    const patterns = configured.length ? configured : siteSlug === "diana" ? undefined : [];
    const page = { ...snapshot.page, content: applyPiiRedactions(snapshot.page.content, { patterns }),
      description: snapshot.page.description ? applyPiiRedactions(snapshot.page.description, { patterns }) : undefined };
    const metadata = legacyRouteMetadata({ page, pathname, siteName: siteSlug === "diana" ? DIANA_SITE_NAME : siteSlug, slug });
    const head = injectHeadMetadata(indexHtml, { ...metadata, noIndex: gate.enabled,
      canonicalUrl: gate.enabled ? undefined : url.origin + pathname });
    const html = injectHtmlFirstPage(head, page, url, siteSlug, criticalCss);
    return new Response(request.method === "HEAD" ? null : html, { headers: { ...headers,
      "Server-Timing": `wiki-shell;dur=${(performance.now() - started).toFixed(1)}, wiki-lookup;dur=${lookupMs.toFixed(1)}`,
      "X-Wiki-Reader": "html-first-3",
    } });
  };
}

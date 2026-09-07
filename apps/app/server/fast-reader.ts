import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { verifyWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { applyPiiRedactions, parseSitePiiPatterns } from "@oncobase/wiki-content/pii";
import { injectHeadMetadata } from "./html-head";
import { DIANA_SITE_NAME, legacyRouteMetadata } from "./legacy-route-metadata";
import { injectHtmlFirstShell } from "./html-first-shell";
import { streamReaderGzip } from "./stream-reader";
import { acceptsGzip, createEncodedReaderCache } from "./encoded-reader-cache";
import { createReaderPolicyCache } from "./reader-policy-cache";
import type { FunctionReturnType } from "convex/server";
import { waitUntil } from "@vercel/functions";
import { gateVersion, readerFingerprint } from "./reader-cache-context";
import { readerSlug } from "./reader-route";

type Snapshot = FunctionReturnType<typeof api.documents.getReaderPage>;
type Policy = FunctionReturnType<typeof api.documents.getReaderPolicy>;
type Page = NonNullable<NonNullable<Snapshot>["page"]>;

export function createFastReader({ indexHtml, criticalCss, client = new ConvexHttpClient(resolveServerConvexUrl()),
  policyCacheMs = process.env.WIKI_READER_POLICY_CACHE_MS === "0" ? 0 : 5000, now = Date.now, background = waitUntil }: {
  indexHtml: string; criticalCss: string; client?: ConvexHttpClient; policyCacheMs?: number;
  now?: () => number; background?: (promise: Promise<unknown>) => void;
}) {
  const encode = createEncodedReaderCache();
  const previewArgs = (host: string) => host.endsWith(".vercel.app") && process.env.WIKI_SITE_SLUG
    ? { previewSiteSlug: process.env.WIKI_SITE_SLUG } : {};
  const policies = createReaderPolicyCache<Policy>({ now, background, maxAgeMs: Math.min(5000, Math.max(0, policyCacheMs)),
    read: host => client.query(api.documents.getReaderPolicy, { host, ...previewArgs(host) }) });
  const bodies = new Map<string, { siteSlug: string; revision: string; page: Page; digest: string; content: string; bytes: number }>();
  let bodyBytes = 0;
  const forget = (key: string) => {
    const value = bodies.get(key);
    if (value) { bodyBytes -= value.bytes; bodies.delete(key); }
  };
  return async (request: Request, expectedFingerprint?: string): Promise<Response | null> => {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const started = performance.now();
    const slug = readerSlug(request);
    if (!slug) return null;
    const bodyKey = JSON.stringify([url.hostname, slug]);
    const cached = bodies.get(bodyKey);
    // Start the optional markdown renderer while the first content read waits.
    const rendering = cached ? undefined : import("./html-first-experiment");
    let snapshot: Snapshot = null;
    let cacheHit = false;
    if (cached && policyCacheMs > 0) {
      const policy = await policies.get(url.hostname);
      if (!policy) { forget(bodyKey); return null; }
      if (policy.siteSlug === cached.siteSlug && policy.contentRevision === cached.revision) {
        snapshot = { ...policy, page: cached.page }; cacheHit = true;
      }
    }
    if (!snapshot || (expectedFingerprint && await readerFingerprint(snapshot) !== expectedFingerprint)) {
      const ticket = policies.begin();
      snapshot = await client.query(api.documents.getReaderPage, {
        host: url.hostname, slug,
        ...(cached ? { knownBody: { siteSlug: cached.siteSlug, digest: cached.digest } } : {}),
        ...previewArgs(url.hostname),
      });
      if (snapshot) policies.put(url.hostname, { siteSlug: snapshot.siteSlug, contentRevision: snapshot.contentRevision,
        gate: snapshot.gate, piiPatterns: snapshot.piiPatterns }, ticket);
    }
    if (!snapshot) { forget(bodyKey); return null; }
    const { siteSlug, gate } = snapshot;
    const headers = { "Cache-Control": "private, no-store", Vary: "Accept, Accept-Encoding, Cookie, Host, User-Agent", "Content-Type": "text/html; charset=utf-8" };
    const cookieName = siteSlug === "diana" ? "authed" : `authed_${siteSlug}`;
    const token = (request.headers.get("cookie") ?? "").split(/;\s*/)
      .find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
    if (gate.enabled && !await verifyWikiGateSession({ siteSlug, token,
      secret: process.env.WIKI_GATE_SESSION_SECRET?.trim(),
      gateVersion: gateVersion(snapshot),
    })) {
      url.searchParams.delete("token");
      const login = new URL("/login", url);
      login.searchParams.set("redirect", url.pathname + url.search);
      return new Response(null, { status: 302, headers: { ...headers, Location: login.toString() } });
    }
    const lookupMs = performance.now() - started;
    if (!snapshot.page?.contentHash || snapshot.page.sensitive !== false) { forget(bodyKey); return null; }
    const content = snapshot.page.content ?? (cached?.siteSlug === siteSlug && cached.digest === snapshot.page.bodyDigest ? cached.content : null);
    if (!content) return null;
    forget(bodyKey);
    const bytes = Buffer.byteLength(content);
    if (snapshot.page.bodyDigest && bytes <= 1_048_576) {
      while (bodies.size && (bodies.size >= 32 || bodyBytes + bytes > 16_777_216)) forget(bodies.keys().next().value!);
      bodies.set(bodyKey, { siteSlug, revision: snapshot.contentRevision, page: { ...snapshot.page, content },
        digest: snapshot.page.bodyDigest, content, bytes }); bodyBytes += bytes;
    }
    const configured = parseSitePiiPatterns(snapshot.piiPatterns);
    const patterns = configured.length ? configured : siteSlug === "diana" ? undefined : [];
    const page = { ...snapshot.page, title: applyPiiRedactions(snapshot.page.title, { patterns }), content: applyPiiRedactions(content, { patterns }),
      description: snapshot.page.description ? applyPiiRedactions(snapshot.page.description, { patterns }) : undefined };
    const frame = (bodyHtml: string) => {
      const metadata = legacyRouteMetadata({ page, pathname, siteName: siteSlug === "diana" ? DIANA_SITE_NAME : siteSlug, slug });
      const head = injectHeadMetadata(indexHtml, { ...metadata, noIndex: gate.enabled,
        canonicalUrl: gate.enabled ? undefined : url.origin + pathname });
      return injectHtmlFirstShell(head, page, url, siteSlug, criticalCss, bodyHtml);
    };
    const gzip = acceptsGzip(request.headers.get("accept-encoding"));
    const cdnAllowed = Boolean(expectedFingerprint && expectedFingerprint === await readerFingerprint(snapshot));
    const representation = [url.href, siteSlug, gate.enabled, page];
    let body: BodyInit | null = gzip ? encode.peek(representation) ?? null : null;
    if (!body) {
      const renderer = await (rendering ?? import("./html-first-experiment"));
      if (gzip && request.method !== "HEAD") {
        const parts = renderer.renderReadableHtmlFirstParts(page);
        const marker = "<!--wiki-stream-body-->";
        const template = frame(marker);
        const split = template.indexOf(marker);
        if (split < 0) return null;
        const first = template.slice(0, split) + parts.first;
        const tail = template.slice(split + marker.length);
        body = streamReaderGzip(first, () => {
          const rest = parts.rest() + tail;
          encode(representation, () => first + rest);
          return rest;
        });
      } else {
        const html = () => frame(renderer.renderHtmlFirstReadingBody(page, siteSlug));
        body = gzip ? encode(representation, html) : html();
      }
    }
    return new Response(request.method === "HEAD" ? null : body, { headers: { ...headers,
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      ...(cdnAllowed ? { "Vercel-CDN-Cache-Control": "max-age=31536000", Vary: "Accept-Encoding, X-Wiki-Reader-Version" } : {}),
      "Server-Timing": `wiki-shell;dur=${(performance.now() - started).toFixed(1)}, wiki-lookup;dur=${lookupMs.toFixed(1)}`,
      "X-Wiki-Reader": "html-first-6",
      "X-Wiki-Reader-Cache": cacheHit ? "hit" : "miss",
    } });
  };
}

import { acceptsGzip } from "./reader-encoding";
import { ConvexHttpClient } from "convex/browser";
import { resolveServerConvexUrl } from "@oncobase/wiki-content/convex-url";
import { verifyWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { next, rewrite } from "@vercel/functions/middleware";
import { waitUntil } from "@vercel/functions";
import { createReaderEdgeSnapshot } from "./reader-edge-snapshot";
import { readerSlug } from "./reader-route";
import { gateVersion, isInternalReaderPath, READER_CONTEXT_HEADER, READER_VERSION_HEADER, readerCachePath, readerFingerprint, readerStaticPath, signReaderContext } from "./reader-cache-context";

export function createReaderEdgeGate(client = new ConvexHttpClient(resolveServerConvexUrl()), staticPrefixes: readonly string[] = []) {
  // This compact catalog is only a routing hint. The full authenticated
  // fingerprint names the file; prefix collisions fall back to the gated
  // function, which verifies the full context and current document again.
  const prebuilt = new Set(staticPrefixes);
  const snapshots = createReaderEdgeSnapshot(client, { background: waitUntil,
    maxAgeMs: process.env.WIKI_READER_POLICY_CACHE_MS === "0" ? 0 : 5000 });
  return async (request: Request) => {
    const started = performance.now();
    const url = new URL(request.url);
    const forwarded = new Headers(request.headers);
    forwarded.delete(READER_CONTEXT_HEADER); forwarded.delete(READER_VERSION_HEADER);
    const pass = () => next({ request: { headers: forwarded } });
    const privateHeaders = { "Cache-Control": "private, no-store", "Vercel-CDN-Cache-Control": "no-store" };
    // External requests can never address the internal cache namespace.
    if (isInternalReaderPath(url.pathname)) return new Response(null, { status: 404, headers: privateHeaders });
    if (process.env.WIKI_HTML_CDN !== "1" || process.env.WIKI_HTML_FIRST !== "1") return pass();
    if (["/api/login", "/api/wiki/manifest", "/api/wiki/pages"].includes(url.pathname)) {
      waitUntil(snapshots.warm(url.hostname).catch(() => {}));
    }
    const slug = readerSlug(request), secret = process.env.WIKI_GATE_SESSION_SECRET?.trim();
    if (!slug || !secret || url.searchParams.has("token") || url.href.length > 4000 || request.headers.has("range") || request.headers.has("authorization")) return pass();
    try {
      const snapshot = await snapshots.get(url.hostname, slug);
      if (!snapshot) return pass();
      const cookieName = snapshot.siteSlug === "diana" ? "authed" : `authed_${snapshot.siteSlug}`;
      const token = (request.headers.get("cookie") ?? "").split(/;\s*/).find(part => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
      if (snapshot.gate.enabled && !await verifyWikiGateSession({ token, secret, siteSlug: snapshot.siteSlug, gateVersion: gateVersion(snapshot) })) {
        const login = new URL("/login", url); login.searchParams.set("redirect", url.pathname + url.search);
        return new Response(null, { status: 302, headers: { ...privateHeaders, Location: login.href } });
      }
      if (!snapshot.page?.contentHash || snapshot.page.sensitive !== false || !snapshot.page.bodyDigest) return pass();
      const fingerprint = await readerFingerprint(snapshot);
      const useStatic = prebuilt.has(fingerprint.slice(0, 8));
      const destination = new URL(useStatic ? readerStaticPath(fingerprint) : await readerCachePath(url.href, fingerprint), url);
      const headers = forwarded;
      // All gzip-capable browsers share one representation despite different br/zstd lists.
      headers.set("Accept-Encoding", acceptsGzip(request.headers.get("accept-encoding")) ? "gzip" : "identity");
      headers.set(READER_CONTEXT_HEADER, await signReaderContext(url.href, fingerprint, secret));
      headers.set(READER_VERSION_HEADER, fingerprint);
      return rewrite(destination, { request: { headers }, headers: {
        "X-Wiki-Edge-Ms": (performance.now() - started).toFixed(1),
        ...(useStatic ? { "Cache-Control": "private, no-store", "X-Wiki-Reader": "html-static-1",
          "X-Wiki-Reader-Cache": "static-route", "X-Wiki-Reader-Static-Version": fingerprint } : {}),
      } });
    } catch {
      // An expired/failed policy lookup must never fall through to a CDN hit.
      return new Response("Reader temporarily unavailable. Please retry.", { status: 503, headers: privateHeaders });
    }
  };
}

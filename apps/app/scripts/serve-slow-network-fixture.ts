/** Synthetic production-build fixture for profile-slow-network.ts and mocked
 * reader tests. No backend credentials or patient data are used.
 * Build the app first, then run this file from any directory. */
import { gzipSync } from "node:zlib";
import { makePublicWikiSessionIdentity, buildCompactTreeFromManifest } from "@oncobase/wiki-content";
const pages = [{ slug: "index", title: "Network test", content: "# Network test\n\nSynthetic reader test.", tags: [], sensitive: false, contentHash: "fixture", size: 39 }];
const manifest = { schemaVersion: 1, siteSlug: "diana", scope: "public", manifestHash: "fixture", generatedAt: new Date().toISOString(), compactTree: buildCompactTreeFromManifest(pages), pages: pages.map(p => ({ ...p, description: null })), assets: [] };
Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.PROFILE_PORT ?? 62184), async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/wiki/session") return Response.json(makePublicWikiSessionIdentity("diana"));
  if (url.pathname === "/api/wiki/manifest") return Response.json(manifest);
  if (url.pathname === "/api/wiki/pages") return Response.json({ siteSlug: "diana", scope: "public", generatedAt: manifest.generatedAt, pages, isDone: true, continueCursor: null });
  if (url.pathname === "/api/wiki/prefetch") return Response.json({ enabled: false, slugs: [] });
  if (url.pathname.startsWith("/api/")) return Response.json({ authenticated: false, user: null });
  const asset = url.pathname.startsWith("/assets/") && !url.pathname.includes("..") ? url.pathname : "/index.html";
  const file = Bun.file(new URL(`../dist${asset}`, import.meta.url));
  if (!await file.exists()) return new Response("Not found", { status: 404 });
  return new Response(gzipSync(await file.arrayBuffer()), { headers: { "Content-Type": file.type, "Content-Encoding": "gzip", "Cache-Control": "no-cache" } });
} });
console.log(`Synthetic reader preview: http://127.0.0.1:${process.env.PROFILE_PORT ?? 62184}`);

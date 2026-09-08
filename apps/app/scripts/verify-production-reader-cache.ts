import { createBackendClient } from "../server/backend-client";
/** Read-only cache-boundary verification against a candidate or production deployment. */
import { api } from "../convex/_generated/api";
import { readerCachePath, readerFingerprint, READER_CONTEXT_HEADER, READER_VERSION_HEADER } from "../server/reader-cache-context";
const origin = process.env.WIKI_PERF_ORIGIN ?? "https://diana-tnbc.com";
const password = process.env.WIKI_PERF_PASSWORD;
if (!password) throw new Error("WIKI_PERF_PASSWORD is required");
async function login() {
  const result = await fetch(origin + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), redirect: "manual" });
  const cookie = result.headers.get("set-cookie")?.split(";")[0];
  await result.body?.cancel();
  if (!result.ok || !cookie) throw new Error("Login failed");
  return cookie;
}
const client = createBackendClient(process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://youthful-cricket-560.convex.cloud");
const hostname = new URL(origin).hostname;
const snapshot = await client.query(api.documents.getReaderPage, { host: hostname, slug: "index", metadataOnly: true,
  ...(hostname.endsWith(".vercel.app") ? { previewSiteSlug: "diana" } : {}) });
if (!snapshot?.page) throw new Error("Reader metadata unavailable");
const fingerprint = await readerFingerprint(snapshot);
const internal = await readerCachePath(origin + "/", fingerprint);
const cookie = await login();
async function check(name: string, pathname: string, headers: Record<string, string>, expected: "article" | "denied") {
  const start = performance.now();
  const result = await fetch(origin + pathname, { headers, redirect: "manual" });
  const deniedStatus = [301, 302, 303, 307, 308, 401, 403, 404].includes(result.status);
  if (expected === "article" ? result.status !== 200 : !deniedStatus) throw new Error("Unexpected reader status for " + name + ": " + result.status);
  const html = await result.text();
  const article = html.includes('id="wiki-html-first"') && html.includes('id="wiki-page-bootstrap"');
  const passed = expected === "article" ? result.status === 200 && article : !article && !html.includes("wiki-page-bootstrap");
  console.log(JSON.stringify({ name, passed, status: result.status, cdn: result.headers.get("x-vercel-cache"), reader: result.headers.get("x-wiki-reader"), cacheControl: result.headers.get("cache-control"), ms: Math.round(performance.now() - start) }));
  if (!passed) throw new Error("Reader cache boundary failed: " + name);
}
await check("authorized fill", "/", { Cookie: cookie }, "article");
await check("authorized cached", "/", { Cookie: cookie }, "article");
const secondCookie = await login();
await check("independent valid session", "/", { Cookie: secondCookie }, "article");
for (const [name, headers] of Object.entries<Record<string, string>>({
  "no cookie": {}, "invalid cookie": { Cookie: "authed=forged" },
  "forged cache version": { [READER_VERSION_HEADER]: fingerprint },
  "forged context": { [READER_CONTEXT_HEADER]: "forged", [READER_VERSION_HEADER]: fingerprint },
  "bot with forged routing": { "User-Agent": "Googlebot", [READER_CONTEXT_HEADER]: "forged", [READER_VERSION_HEADER]: fingerprint },
  "middleware bypass header": { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware", [READER_VERSION_HEADER]: fingerprint },
})) await check(name, "/", headers, "denied");
for (const [name, pathname] of Object.entries({ "direct cache path": internal,
  "encoded cache namespace": internal.replace("/__reader/", "/%5F%5Freader/"),
  "internal API route": "/api/app-shell?__path=" + encodeURIComponent(internal.slice(1)),
})) await check(name, pathname, { Cookie: cookie, [READER_CONTEXT_HEADER]: "forged", [READER_VERSION_HEADER]: fingerprint }, "denied");
await check("HTML-disabled fallback remains gated", "/?html-first=off", { [READER_VERSION_HEADER]: fingerprint }, "denied");

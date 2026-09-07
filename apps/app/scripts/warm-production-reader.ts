/** Fill the gated HTML CDN using ordinary authorized reads after a deployment. */
import { mkdir, writeFile } from "node:fs/promises";
import { readerSlug } from "../server/reader-route";
const origin = process.env.WIKI_PERF_ORIGIN ?? "https://diana-tnbc.com";
const password = process.env.WIKI_PERF_PASSWORD;
if (!password) throw new Error("WIKI_PERF_PASSWORD is required");
const login = await fetch(origin + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), redirect: "manual" });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
await login.body?.cancel();
if (!login.ok || !cookie) throw new Error("Login failed");
let paths = process.env.WIKI_WARM_PATHS?.split(",");
if (!paths) {
  const manifestResponse = await fetch(origin + "/api/wiki/manifest?scope=public", { headers: { Cookie: cookie } });
  if (!manifestResponse.ok) throw new Error("Public manifest unavailable");
  const manifest = await manifestResponse.json() as { scope: string; pages: { slug: string; sensitive: boolean }[] };
  if (manifest.scope !== "public" || !Array.isArray(manifest.pages)) throw new Error("Invalid public manifest");
  paths = manifest.pages.filter(page => page.sensitive === false).map(page => page.slug === "index" ? "/" : "/" + page.slug.split("/").map(encodeURIComponent).join("/"));
}
paths = [...new Set(paths)].filter(path => readerSlug(new Request(origin + path)));
const limit = Number(process.env.WIKI_WARM_LIMIT ?? paths.length);
paths = paths.slice(0, limit);
const concurrency = Math.min(8, Math.max(1, Number(process.env.WIKI_WARM_CONCURRENCY ?? "6")));
const records: { path: string; status: number; reader: string | null; cdn: string | null; bytes: number; ms: number }[] = [];
let index = 0, failed = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (index < paths.length) {
    const path = paths[index++], started = performance.now();
    try {
      const result = await fetch(origin + path, { headers: { Cookie: cookie, "Accept-Encoding": "gzip" }, redirect: "manual" });
      const reader = result.headers.get("x-wiki-reader");
      const bytes = (await result.arrayBuffer()).byteLength;
      const record = { path, status: result.status, reader, cdn: result.headers.get("x-vercel-cache"), bytes, ms: Math.round(performance.now() - started) };
      records.push(record);
      if (result.status !== 200 || !reader) failed++;
    } catch { failed++; records.push({ path, status: 0, reader: null, cdn: null, bytes: 0, ms: Math.round(performance.now() - started) }); }
    if (records.length % 100 === 0 || records.length === paths.length) console.log(JSON.stringify({ completed: records.length, total: paths.length, failed }));
  }
}));
await mkdir(".playwright/production-reading", { recursive: true });
await writeFile(".playwright/production-reading/warm-" + new URL(origin).hostname + ".json", JSON.stringify({ origin, measuredAt: new Date().toISOString(), concurrency, total: paths.length, failed, records }, null, 2));
if (failed) process.exitCode = 1;

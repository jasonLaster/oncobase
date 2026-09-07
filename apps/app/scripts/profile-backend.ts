/** Read-only backend profile. Outputs counts/timings only, never payloads. */
import { resolve } from "node:path";
import { getFunctionName } from "convex/server";
import type { WikiApiContext } from "@oncobase/wiki-content/server";

const mode = process.argv[2] ?? "fixture";
const modulePath = process.argv[3];
const latency = 20;

if (mode === "fixture") {
  const { createWikiManifestResponse } = await import(modulePath ? resolve(modulePath) : "../../../packages/wiki-content/src/server.ts");
  const slugs = Array.from({ length: 850 }, (_, i) => `private/${String(i).padStart(4, "0")}`);
  let calls = 0;
  let checkedSlugs = 0;
  let active = 0;
  let peak = 0;
  const context = {
    siteSlug: "fixture",
    getSessionUser: async () => ({ _id: "reader" }),
    access: {
      canUserAccessSlug: async () => false,
      getAllowedSlugs: async () => [],
      async filterAccessibleSlugs(_user, batch) {
        calls++;
        checkedSlugs += batch.length;
        peak = Math.max(peak, ++active);
        await Bun.sleep(latency);
        active--;
        return batch.map((slug) => ({ slug, allowed: true, hasDocument: true }));
      },
    },
    documents: {
      listPageWithContent: async () => ({ page: [], isDone: true, continueCursor: null }),
      listPdfAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      listFileAssetPathsPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      listFileAssetVisibilityPage: async () => ({ page: [], isDone: true, continueCursor: null }),
      getBySlug: async () => null,
      listManifestPage: async () => ({ page: slugs.map((slug) => ({ slug, title: slug, tags: [], description: null, contentHash: null, sensitive: true, size: 1 })), isDone: true, continueCursor: null }),
      listPdfAssetVisibilityPage: async () => ({ page: slugs.map((slug) => ({ path: `${slug}.pdf`, ownerSlugs: [slug], sensitive: true })), isDone: true, continueCursor: null }),
    },
  } as WikiApiContext;
  const started = performance.now();
  const response = await createWikiManifestResponse(new Request("http://localhost/api/wiki/manifest?scope=session"), context);
  const body = await response.json();
  console.log(JSON.stringify({ mode, durationMs: Math.round(performance.now() - started), accessCalls: calls, checkedSlugs, peakConcurrency: peak, pages: body.pages.length, assets: body.assets.length, manifestHash: body.manifestHash, simulatedRpcMs: latency }));
} else if (mode === "live") {
  // Use the configured backend (including the app's documented production
  // fallback). The gate cookie exists only in this process, signed with a
  // random local secret; no login/account/publish mutations are performed.
  const { createClient, createWikiApiHandler, getPasswordGateConfig, authedCookieName } = await import(modulePath ? resolve(modulePath) : "../server/wiki-api.ts");
  const { createWikiGateSession } = await import("@oncobase/wiki-content/gate-session");
  const client = createClient();
  const siteSlug = process.env.WIKI_SITE_SLUG ?? "diana";
  process.env.WIKI_SITE_SLUG = siteSlug;
  const secret = crypto.randomUUID();
  process.env.WIKI_GATE_SESSION_SECRET = secret;
  const config = await getPasswordGateConfig(client, siteSlug);
  const token = await createWikiGateSession({ siteSlug, secret, gateVersion: JSON.stringify([config.enabled, config.passwordHash ?? (siteSlug === "diana" ? process.env.DIANA_WIKI_PASSWORD_HASH : undefined) ?? "passwordless"]) });
  let calls: Array<{ name: string; durationMs: number }> = [];
  const measured = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== "query") return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => {
        const started = performance.now();
        try { return await value.apply(target, args); }
        finally { calls.push({ name: getFunctionName(args[0] as never), durationMs: Math.round(performance.now() - started) }); }
      };
    },
  });
  const handler = createWikiApiHandler(measured);
  const run = async (label: string, path: string) => {
    calls = [];
    const started = performance.now();
    const response = await handler(new Request(`http://localhost${path}`, { headers: { Cookie: `${authedCookieName(siteSlug)}=${token}` } }));
    if (!response || response.status !== 200) throw new Error(`Profile failed: ${response?.status}`);
    const body = await response.json();
    const grouped: Record<string, typeof calls> = {};
    for (const call of calls) (grouped[call.name] ??= []).push(call);
    console.log(JSON.stringify({ mode, label, durationMs: Math.round(performance.now() - started), pages: body.pages?.length, assets: body.assets?.length, partial: response.headers.get("x-wiki-manifest-partial"), calls: Object.fromEntries(Object.entries(grouped).map(([name, entries]) => [name, { count: entries!.length, summedMs: entries!.reduce((sum, entry) => sum + entry.durationMs, 0) }])) }));
    return body;
  };
  const manifest = await run("manifest-public", "/api/wiki/manifest?scope=public");
  const slugs = manifest.pages.slice(0, 25).map((page: { slug: string }) => page.slug);
  if (!slugs.length) throw new Error("Profile manifest contains no public pages");
  await run("pages-cold-25", `/api/wiki/pages?scope=public&slugs=${encodeURIComponent(slugs.join(","))}`);
  await run("pages-warm-25", `/api/wiki/pages?scope=public&slugs=${encodeURIComponent(slugs.join(","))}`);
} else {
  throw new Error("Usage: profile-backend.ts fixture|live [baseline module path]");
}

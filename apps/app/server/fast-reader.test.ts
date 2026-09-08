import { afterEach, expect, test } from "bun:test";
import { createWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { createFastReader } from "./fast-reader";
import { gunzipSync } from "node:zlib";
import { readerFingerprint, type ReaderSnapshot } from "./reader-cache-context";
import { getFunctionName } from "convex/server";

const originalSecret = process.env.WIKI_GATE_SESSION_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.WIKI_GATE_SESSION_SECRET;
  else process.env.WIKI_GATE_SESSION_SECRET = originalSecret;
});

test("cached HTML follows site revisions and enforces gate rotation within five seconds", async () => {
  process.env.WIKI_GATE_SESSION_SECRET = "synthetic-gate-secret";
  let clock = 0, calls = 0, revision = "site:1", visible = true, passwordHash = "fixture-hash", replacement = "FIRST";
  const client = { query: async (ref: Parameters<typeof getFunctionName>[0]) => {
    calls++;
    const policy = { siteSlug: "diana", contentRevision: revision, gate: { enabled: true, passwordHash },
      piiPatterns: [JSON.stringify({ pattern: "PERSON_LITERAL", replacement })] };
    return getFunctionName(ref).endsWith("getReaderPolicy") ? policy : { ...policy,
      page: visible ? { slug: "index", title: "Home", content: "PERSON_LITERAL", bodyDigest: "digest", contentHash: "same", sensitive: false, tags: [] } : null };
  } };
  const handler = createFastReader({ client: client as never, now: () => clock, background: () => {},
    criticalCss: ":root{--brand:blue}", indexHtml: '<html><head></head><body><div id="root"></div></body></html>' });
  const token = await createWikiGateSession({ siteSlug: "diana", secret: process.env.WIKI_GATE_SESSION_SECRET,
    gateVersion: JSON.stringify([true, passwordHash]) });
  const request = (cookie = token) => new Request("https://diana-tnbc.com/", { headers: { Cookie: `authed=${cookie}`, "Accept-Encoding": "gzip" } });
  await handler(request());
  const hit = await handler(request());
  expect(hit?.headers.get("X-Wiki-Reader-Cache")).toBe("hit");
  expect(calls).toBe(1);
  expect((await handler(request("forged")))?.status).toBe(302);
  replacement = "SECOND"; clock = 5000;
  expect(gunzipSync(await (await handler(request()))!.arrayBuffer()).toString()).toContain("SECOND");
  revision = "site:2"; visible = false; clock = 10_000;
  expect(await handler(request())).toBeNull();
  visible = true; await handler(request());
  passwordHash = "rotated"; clock = 15_000;
  expect((await handler(request()))?.status).toBe(302);
});
for (const gzip of [false, true]) test(`fast reader checks current access and redactions before ${gzip ? "compressed" : "plain"} cache hits`, async () => {
  process.env.WIKI_GATE_SESSION_SECRET = "synthetic-gate-secret";
  let calls = 0, visible = true, passwordHash = "fixture-hash", replacement = "FIRST_REDACTION";
  const client = { query: async (_ref: unknown, args: { knownBody?: { digest: string } }) => { calls++; return { siteSlug: "diana", gate: { enabled: true, passwordHash },
    piiPatterns: [JSON.stringify({ pattern: "PERSON_LITERAL", replacement })],
    page: visible ? { slug: "index", title: "Home", content: args.knownBody?.digest === "digest" ? null : "PERSON_LITERAL", bodyDigest: "digest", contentHash: "same", sensitive: false as const, tags: [] } : null }; } };
  const handler = createFastReader({ client: client as never, policyCacheMs: 0, criticalCss: ":root{--brand:blue}",
    indexHtml: '<html><head><title>Wiki</title></head><body><div id="root"></div></body></html>' });
  const token = await createWikiGateSession({ siteSlug: "diana", secret: process.env.WIKI_GATE_SESSION_SECRET, gateVersion: JSON.stringify([true, passwordHash]) });
  const request = (cookie = token) => new Request("https://diana-tnbc.com/", { headers: { Cookie: `authed=${cookie}`, ...(gzip ? { "Accept-Encoding": "gzip" } : {}) } });
  const decode = async (response: Response) => gzip ? gunzipSync(await response.arrayBuffer()).toString() : response.text();
  const first = await handler(request());
  expect(calls).toBe(1);
  expect(first?.headers.get("Cache-Control")).toBe("private, no-store");
  expect(first!.headers.get("content-encoding")).toBe(gzip ? "gzip" : null);
  const html = await decode(first!);
  expect(html).toContain("FIRST_REDACTION"); expect(html).not.toContain("PERSON_LITERAL");
  replacement = "NEW_REDACTION";
  expect(await decode((await handler(request()))!)).toContain("NEW_REDACTION");
  expect((await handler(request("1")))?.status).toBe(302);
  passwordHash = "rotated";
  expect((await handler(request()))?.status).toBe(302);
  passwordHash = "fixture-hash"; visible = false;
  expect(await handler(request())).toBeNull();
});


test("only an attested, current fingerprint permits CDN storage, including a content change during cache fill", async () => {
  process.env.WIKI_GATE_SESSION_SECRET = "synthetic-gate-secret";
  let value: ReaderSnapshot = { siteSlug: "diana", contentRevision: "site:1", gate: { enabled: true, passwordHash: "fixture" }, piiPatterns: [],
    page: { slug: "index", title: "Home", content: "ORIGINAL BODY", bodyDigest: "original", contentHash: "source", description: undefined, sensitive: false, tags: [] } };
  const client = { query: async (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref).endsWith("getReaderPolicy")
    ? { ...value, page: undefined } : structuredClone(value) };
  const handler = createFastReader({ client: client as never, now: () => 0, background: () => {},
    criticalCss: ":root{--brand:blue}", indexHtml: '<html><head></head><body><div id="root"></div></body></html>' });
  const token = await createWikiGateSession({ siteSlug: "diana", secret: process.env.WIKI_GATE_SESSION_SECRET,
    gateVersion: JSON.stringify([true, "fixture"]) });
  const fingerprint = await readerFingerprint(value);
  const request = (cookie = token) => new Request("https://diana-tnbc.com/", { headers: { Cookie: `authed=${cookie}`,
    "x-wiki-reader-version": fingerprint, "x-wiki-reader-context": "forged" } });
  expect((await handler(request()))!.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  const allowed = (await handler(request(), fingerprint))!;
  expect(allowed.headers.get("Vercel-CDN-Cache-Control")).toBe("max-age=31536000");
  expect(allowed.headers.get("Cache-Control")).toBe("private, no-store");
  expect(allowed.headers.get("Vary")).toBe("Accept-Encoding, X-Wiki-Reader-Version");
  expect((await handler(request("forged"), fingerprint))!.status).toBe(302);
  // Simulate an edit even without a manifest bump: the edge digest must force a fresh origin read.
  value = { ...value, page: { ...value.page!, content: "CHANGED BODY", bodyDigest: "changed" } };
  const updated = (await handler(request(), await readerFingerprint(value)))!;
  expect(updated.headers.get("Vercel-CDN-Cache-Control")).toBe("max-age=31536000");
  expect(await updated.text()).toContain("CHANGED BODY");
  // The edge attested the old version just before the origin observed an edit.
  const raced = (await handler(request(), fingerprint))!;
  expect(raced.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  expect(await raced.text()).not.toContain("ORIGINAL BODY");
  value = { ...value, page: null };
  expect(await handler(request(), fingerprint)).toBeNull();
});

test("HTML carries current public navigation and invalidates encoded navigation when only the site revision changes", async () => {
  let revision = "site:1";
  const client = { query: async () => ({ siteSlug: "fixture", contentRevision: revision,
    gate: { enabled: false }, piiPatterns: [], page: {slug:"index",title:"Home",content:"Readable",contentHash:"same",bodyDigest:"same",sensitive:false,tags:[]} }) };
  const handler = createFastReader({client:client as never,policyCacheMs:0,criticalCss:"",indexHtml:'<html><head></head><body><div id="root"></div></body></html>',
    navigation: async () => [{name:revision === "site:1" ? "old" : "new",slug:revision === "site:1" ? "old" : "new",type:"file"}]});
  const read = async () => gunzipSync(await (await handler(new Request("https://fixture.test/",{headers:{"Accept-Encoding":"gzip"}})))!.arrayBuffer()).toString();
  expect(await read()).toContain('href="/old"');
  revision = "site:2";
  const updated = await read();
  expect(updated).toContain('href="/new"');
  expect(updated).not.toContain('href="/old"');
  expect(updated.indexOf('href="/new"')).toBeLessThan(updated.indexOf("Readable"));
});

import { getFunctionName } from "convex/server";
import { afterEach, expect, test } from "bun:test";
import { createWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { createReaderEdgeGate } from "./reader-edge-gate";
import { gateVersion, readerCachePath, readerFingerprint, READER_CONTEXT_HEADER, READER_VERSION_HEADER, signReaderContext, verifyReaderContext, type ReaderSnapshot } from "./reader-cache-context";

const saved = { WIKI_HTML_FIRST: process.env.WIKI_HTML_FIRST, WIKI_HTML_CDN: process.env.WIKI_HTML_CDN,
  WIKI_GATE_SESSION_SECRET: process.env.WIKI_GATE_SESSION_SECRET, WIKI_READER_POLICY_CACHE_MS: process.env.WIKI_READER_POLICY_CACHE_MS };
afterEach(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const snapshot = (): ReaderSnapshot => ({ siteSlug: "diana", contentRevision: "site:1", gate: { enabled: true, passwordHash: "fixture" }, piiPatterns: [],
  page: { slug: "index", title: "Home", content: null, bodyDigest: "actual-body-digest", contentHash: "source", description: undefined, sensitive: false, tags: [] } });
const secret = "synthetic-cdn-gate-secret";

test("the edge authenticates before a versioned CDN rewrite, blocks direct cache URLs and strips forged routing headers", async () => {
  Object.assign(process.env, { WIKI_HTML_FIRST: "1", WIKI_HTML_CDN: "1", WIKI_GATE_SESSION_SECRET: secret, WIKI_READER_POLICY_CACHE_MS: "0" });
  let value = snapshot();
  const gate = createReaderEdgeGate({ query: async (ref: Parameters<typeof getFunctionName>[0], args: { metadataOnly?: boolean }) => {
    if (getFunctionName(ref).endsWith("getReaderPage")) expect(args.metadataOnly).toBe(true);
    return structuredClone(value);
  } } as never);
  const token = await createWikiGateSession({ siteSlug: "diana", secret, gateVersion: gateVersion(value) });
  const url = "https://diana-tnbc.com/";
  const request = (cookie = token, headers = {}) => new Request(url, { headers: { Cookie: "authed=" + cookie, ...headers } });
  const result = await gate(request(token, { "Accept-Encoding": "gzip, deflate, br, zstd" }));
  expect(result.headers.get("x-middleware-request-accept-encoding")).toBe("gzip");
  expect((await gate(request(token, { "Accept-Encoding": "gzip;q=0, br" }))).headers.get("x-middleware-request-accept-encoding")).toBe("identity");
  const destination = result.headers.get("x-middleware-rewrite")!;
  const context = result.headers.get("x-middleware-request-" + READER_CONTEXT_HEADER)!;
  expect(destination).toContain("/__reader/html/");
  const restored = await verifyReaderContext(new Request(destination, { headers: { [READER_CONTEXT_HEADER]: context } }), secret);
  expect(restored?.url.href).toBe(url);
  expect((await gate(request("forged"))).status).toBe(302);
  expect((await gate(new Request(destination))).status).toBe(404);
  expect((await gate(new Request(destination.replace("/__reader/", "/%5F%5Freader/")))).status).toBe(404);
  const bypass = await gate(request("", { "User-Agent": "Googlebot", [READER_CONTEXT_HEADER]: context, [READER_VERSION_HEADER]: restored!.fingerprint }));
  expect(bypass.headers.get("x-middleware-request-" + READER_VERSION_HEADER)).toBeNull();
  expect(bypass.headers.get("x-middleware-request-" + READER_CONTEXT_HEADER)).toBeNull();
  value = { ...value, page: null };
  expect((await gate(request())).headers.get("x-middleware-rewrite")).toBeNull();
  value.gate.passwordHash = "rotated";
  expect((await gate(request())).status).toBe(302);
});

test("internal cache attestations are bound to the exact URL, origin, version and expiry", async () => {
  const original = "https://diana-tnbc.com/wiki/example", fp = await readerFingerprint(snapshot());
  const path = await readerCachePath(original, fp);
  const token = await signReaderContext(original, fp, secret, 1000);
  const req = (url: string, header = token) => new Request(url, { headers: { [READER_CONTEXT_HEADER]: header } });
  expect(await verifyReaderContext(req("https://diana-tnbc.com" + path), secret, 1000)).not.toBeNull();
  expect(await verifyReaderContext(req("https://other.test" + path), secret, 1000)).toBeNull();
  expect(await verifyReaderContext(req("https://diana-tnbc.com" + path + "changed"), secret, 1000)).toBeNull();
  expect(await verifyReaderContext(req("https://diana-tnbc.com" + path), secret, 16_000)).toBeNull();
  expect(await verifyReaderContext(req("https://diana-tnbc.com" + path, token + "tampered"), secret, 1000)).toBeNull();
});

test("CDN versions change with actual page bytes or policy, or navigation changes", async () => {
  const first = snapshot(), key = await readerFingerprint(first);
  expect(await readerFingerprint({ ...first, contentRevision: "site:2" })).not.toBe(key);
  expect(await readerFingerprint({ ...first, page: { ...first.page!, content: "body bytes omitted from metadata query" } })).toBe(key);
  for (const changed of [
    { ...first, page: { ...first.page!, bodyDigest: "new" } },
    { ...first, page: { ...first.page!, title: "new" } },
    { ...first, piiPatterns: ["new policy"] },
    { ...first, gate: { enabled: true, passwordHash: "new" } },
    { ...first, page: null },
    { ...first, contentRevision: "recreated-site:1" },
  ]) expect(await readerFingerprint(changed)).not.toBe(key);
});

test("failed edge policy lookup cannot reach the CDN", async () => {
  Object.assign(process.env, { WIKI_HTML_FIRST: "1", WIKI_HTML_CDN: "1", WIKI_GATE_SESSION_SECRET: secret });
  const gate = createReaderEdgeGate({ query: async () => { throw new Error("offline"); } } as never);
  const result = await gate(new Request("https://diana-tnbc.com/"));
  expect(result.status).toBe(503);
  expect(result.headers.get("x-middleware-rewrite")).toBeNull();
});


test("a deployment change invalidates HTML that references the preceding build's assets", async () => {
  const before = process.env.VERCEL_URL;
  try {
    process.env.VERCEL_URL = "first-build.vercel.app";
    const first = await readerFingerprint(snapshot());
    process.env.VERCEL_URL = "second-build.vercel.app";
    expect(await readerFingerprint(snapshot())).not.toBe(first);
  } finally {
    if (before === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = before;
  }
});

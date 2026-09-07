import { afterEach, expect, test } from "bun:test";
import { createWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { createFastReader } from "./fast-reader";
import { gunzipSync } from "node:zlib";
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

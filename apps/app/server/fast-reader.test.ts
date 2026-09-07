import { afterEach, expect, test } from "bun:test";
import { createWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { createFastReader } from "./fast-reader";

const originalSecret = process.env.WIKI_GATE_SESSION_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.WIKI_GATE_SESSION_SECRET;
  else process.env.WIKI_GATE_SESSION_SECRET = originalSecret;
});
test("fast reader makes one fresh policy/content read, checks the gate and invalidates rendered redactions", async () => {
  process.env.WIKI_GATE_SESSION_SECRET = "synthetic-gate-secret";
  let calls = 0, visible = true, passwordHash = "fixture-hash", replacement = "FIRST_REDACTION";
  const client = { query: async (_ref: unknown, args: { knownBody?: { digest: string } }) => { calls++; return { siteSlug: "diana", gate: { enabled: true, passwordHash },
    piiPatterns: [JSON.stringify({ pattern: "PERSON_LITERAL", replacement })],
    page: visible ? { slug: "index", title: "Home", content: args.knownBody?.digest === "digest" ? null : "PERSON_LITERAL", bodyDigest: "digest", contentHash: "same", sensitive: false as const, tags: [] } : null }; } };
  const handler = createFastReader({ client: client as never, criticalCss: ":root{--brand:blue}",
    indexHtml: '<html><head><title>Wiki</title></head><body><div id="root"></div></body></html>' });
  const token = await createWikiGateSession({ siteSlug: "diana", secret: process.env.WIKI_GATE_SESSION_SECRET, gateVersion: JSON.stringify([true, passwordHash]) });
  const request = (cookie = token) => new Request("https://diana-tnbc.com/", { headers: { Cookie: `authed=${cookie}` } });
  const first = await handler(request());
  expect(calls).toBe(1);
  expect(first?.headers.get("Cache-Control")).toBe("private, no-store");
  const html = await first!.text();
  expect(html).toContain("FIRST_REDACTION"); expect(html).not.toContain("PERSON_LITERAL");
  replacement = "NEW_REDACTION";
  expect(await (await handler(request()))!.text()).toContain("NEW_REDACTION");
  expect((await handler(request("1")))?.status).toBe(302);
  passwordHash = "rotated";
  expect((await handler(request()))?.status).toBe(302);
  passwordHash = "fixture-hash"; visible = false;
  expect(await handler(request())).toBeNull();
});

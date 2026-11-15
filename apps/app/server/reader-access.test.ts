// P9: the host and gate caches hold in-flight promises (a burst shares one
// lookup), gate configuration is shared for GATE_CACHE_TTL_MS, failures are
// never cached, and `sites:gate` falls back to `sites:getBySlug` only while
// Convex does not have it yet.
import { expect, test } from "bun:test";
import { getFunctionName, type FunctionReference } from "convex/server";
import { GATE_CACHE_TTL_MS, getPiiPatterns, getRequestPasswordGateConfig, getSiteGate, resolveSiteSlug } from "./reader-access";

function client(handlers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: string[] = [];
  return {
    calls,
    query: async (ref: FunctionReference<"query">, args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      calls.push(name);
      await Bun.sleep(5);
      const handler = handlers[name];
      if (!handler) throw new Error(`Could not find public function for '${name}'`);
      return handler(args);
    },
  };
}

const gate = { passwordGate: true, passwordHash: "sha256:fixture", piiPatterns: ['/SECRET/g=>[x]'] };

test("a burst of 20 parallel gate lookups makes one Convex read", async () => {
  const fake = client({ "sites:gate": () => gate });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    getRequestPasswordGateConfig(new Request(`https://wiki.test/${i}`), fake as never, "burst")));
  expect(fake.calls).toEqual(["sites:gate"]);
  expect(new Set(results.map(result => JSON.stringify(result)))).toEqual(new Set([JSON.stringify({ enabled: true, passwordHash: "sha256:fixture" })]));
  // Redaction shares the same cached read.
  expect(await getPiiPatterns(fake as never, "burst")).toHaveLength(1);
  expect(fake.calls).toEqual(["sites:gate"]);
});

test("gate configuration expires after GATE_CACHE_TTL_MS and failures are never cached", async () => {
  let fail = true;
  const fake = client({ "sites:gate": () => { if (fail) throw new Error("unavailable"); return gate; } });
  const now = Date.now();
  await expect(getSiteGate(fake as never, "ttl", now)).rejects.toThrow("unavailable");
  fail = false;
  expect(await getSiteGate(fake as never, "ttl", now + 1)).toEqual(gate);
  expect(await getSiteGate(fake as never, "ttl", now + GATE_CACHE_TTL_MS)).toEqual(gate);
  expect(fake.calls).toHaveLength(2);
  await getSiteGate(fake as never, "ttl", now + 1 + GATE_CACHE_TTL_MS + 1);
  expect(fake.calls).toHaveLength(3);
});

test("the gate never exposes more of the site row than the slim query returns", async () => {
  const row = { slug: "legacy", publishTokenHash: "sha256:publisher", publishTokens: [{ hash: "sha256:t" }], liveblocksSecretKey: "sk_live",
    config: { passwordGate: false, passwordHash: "sha256:gate", piiPatterns: [] } };
  // Older Convex: sites:gate is missing, so the full row is read and sliced.
  const legacy = client({ "sites:getBySlug": () => row });
  const sliced = await getSiteGate(legacy as never, "legacy");
  expect(sliced).toEqual({ passwordGate: false, passwordHash: "sha256:gate", piiPatterns: [] });
  expect(JSON.stringify(sliced)).not.toContain("publisher");
  expect(JSON.stringify(sliced)).not.toContain("sk_live");
  expect(legacy.calls).toEqual(["sites:gate", "sites:getBySlug"]);
  // Any other failure of sites:gate fails closed rather than falling back.
  const broken = client({ "sites:gate": () => { throw new Error("timeout"); }, "sites:getBySlug": () => row });
  await expect(getSiteGate(broken as never, "broken")).rejects.toThrow("timeout");
  expect(broken.calls).toEqual(["sites:gate"]);
});

test("a burst of host resolutions shares one lookup and a failed lookup is retried", async () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, WIKI_SITE_SLUG: process.env.WIKI_SITE_SLUG, SITE_SLUG: process.env.SITE_SLUG };
  process.env.NODE_ENV = "production";
  delete process.env.WIKI_SITE_SLUG;
  delete process.env.SITE_SLUG;
  try {
    const fake = client({ "sites:getByHost": () => ({ slug: "custom" }) });
    const slugs = await Promise.all(Array.from({ length: 20 }, () =>
      resolveSiteSlug(new Request("https://burst.example.test/api/wiki/manifest"), fake as never)));
    expect(new Set(slugs)).toEqual(new Set(["custom"]));
    expect(fake.calls).toEqual(["sites:getByHost"]);
    let fail = true;
    const flaky = client({ "sites:getByHost": () => { if (fail) throw new Error("unavailable"); return { slug: "flaky" }; } });
    await expect(resolveSiteSlug(new Request("https://flaky.example.test/"), flaky as never)).rejects.toThrow("unavailable");
    fail = false;
    expect(await resolveSiteSlug(new Request("https://flaky.example.test/"), flaky as never)).toBe("flaky");
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

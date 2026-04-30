/**
 * Phase 5 cross-site leak tests.
 *
 * Three invariants from MVP.md that any new feature must respect:
 *
 *   1. Same-slug isolation, cold and warm — alpha and beta have a
 *      `home` document with different content; concurrent requests
 *      get the right one; the second-host hit doesn't pick up the
 *      first-host cache.
 *   2. Header injection — `x-site-slug: <other>` is overwritten by
 *      the proxy and ignored.
 *   3. Search ranking — both sites contain the same term; search
 *      from each host returns only that host's documents.
 *
 * Setup: spins up two synthetic sites (alpha, beta) directly in the
 * dev Convex deployment, publishes a tiny document to each via the
 * /api/publish route, runs the invariants, then archives both sites
 * and tombstones the seeded documents on teardown.
 */
import crypto from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://fleet-ferret-544.convex.cloud";

// Unique slugs per run so the test is idempotent without needing
// upsert semantics on sites:create. Slugs must match
// /^[a-z0-9-]{1,32}$/ — base36 timestamp + random gives plenty of
// uniqueness while staying under 32 chars and using only [a-z0-9].
const RUN_NONCE = `${Date.now().toString(36)}${crypto
  .randomBytes(2)
  .toString("hex")}`;
const ALPHA_SLUG = `iso-a-${RUN_NONCE}`;
const BETA_SLUG = `iso-b-${RUN_NONCE}`;

function tokenAndHash() {
  const token = `wpt_${crypto.randomBytes(24).toString("base64url")}`;
  const hash = `sha256:${crypto.createHash("sha256").update(token).digest("hex")}`;
  return { token, hash };
}

async function publishOne(
  request: APIRequestContext,
  baseURL: string,
  siteSlug: string,
  token: string,
  doc: { slug: string; title: string; content: string; tags: string[] },
) {
  const hash = `${doc.slug}-${Date.now()}`;
  const begin = await request.post(`${baseURL}/api/publish/begin`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      siteSlug,
      manifest: {
        documents: [{ slug: doc.slug, hash }],
        assets: [],
      },
      force: true,
    },
  });
  expect(begin.ok(), await begin.text()).toBeTruthy();
  const { runId } = (await begin.json()) as { runId: string };

  const docResp = await request.post(`${baseURL}/api/publish/document`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { runId, siteSlug, ...doc, hash },
  });
  expect(docResp.ok(), await docResp.text()).toBeTruthy();

  const finish = await request.post(`${baseURL}/api/publish/finish`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { runId, siteSlug, deletedDocSlugs: [], deletedAssetPaths: [] },
  });
  expect(finish.ok(), await finish.text()).toBeTruthy();
}

test.describe("multi-site isolation", () => {
  let convex: ConvexHttpClient;
  let alphaToken: string;
  let betaToken: string;

  test.beforeAll(async ({ request, baseURL }) => {
    const url = baseURL ?? "http://localhost:3000";
    convex = new ConvexHttpClient(CONVEX_URL);

    const { token: alphaT, hash: alphaH } = tokenAndHash();
    const { token: betaT, hash: betaH } = tokenAndHash();
    alphaToken = alphaT;
    betaToken = betaT;

    // Slugs include a per-run nonce so create() never collides with
    // a previous test run. Cleanup happens in afterAll.
    await convex.mutation(api.sites.create, {
      slug: ALPHA_SLUG,
      name: `${ALPHA_SLUG} (test)`,
      ownerEmail: "isolation@test",
      domain: `${ALPHA_SLUG}.localhost`,
      publishTokenHash: alphaH,
    });
    await convex.mutation(api.sites.create, {
      slug: BETA_SLUG,
      name: `${BETA_SLUG} (test)`,
      ownerEmail: "isolation@test",
      domain: `${BETA_SLUG}.localhost`,
      publishTokenHash: betaH,
    });

    // Each site gets a unique marker token that does NOT share any
    // word with the other side's marker (Convex tokenizes search
    // queries by word; if "alphabarbatross" and "BBB-secret-token"
    // both contain "secret", a beta query for the AAA marker would
    // match beta's "secret" via partial tokenization, defeating the
    // isolation check). The shared word is "treatment" — used in
    // invariant 3 explicitly.
    await publishOne(request, url, ALPHA_SLUG, alphaToken, {
      slug: "home",
      title: "Alpha Home",
      content:
        "Alpha home page. Marker alphabarbatross. Treatment overview for alpha.",
      tags: ["isolation", "alpha"],
    });
    await publishOne(request, url, BETA_SLUG, betaToken, {
      slug: "home",
      title: "Beta Home",
      content:
        "Beta home page. Marker betarhinoceros. Treatment overview for beta.",
      tags: ["isolation", "beta"],
    });
  });

  test.afterAll(async () => {
    if (!convex) return;
    // Tombstone the seeded docs and archive the sites.
    for (const slug of [ALPHA_SLUG, BETA_SLUG]) {
      try {
        await convex.mutation(api.documents.deleteBySlug, {
          siteSlug: slug,
          slug: "home",
        });
        await convex.mutation(api.sites.archive, { slug });
      } catch {
        // best-effort cleanup
      }
    }
  });

  test("invariant 1: same-slug isolation cold and warm", async ({
    request,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    // Cold: query alpha first, then beta. Each must see only its own
    // content; the search must not return the other site's secret.
    const alphaCold = await request.get(`${url}/api/search?q=alphabarbatross`, {
      headers: { Host: `${ALPHA_SLUG}.localhost` },
    });
    const alphaColdJson = (await alphaCold.json()) as {
      results: Array<{ slug: string; excerpt: string }>;
    };
    expect(alphaColdJson.results.length).toBeGreaterThan(0);
    expect(alphaColdJson.results[0].slug).toBe("home");
    expect(alphaColdJson.results[0].excerpt).toContain("alphabarbatross");

    const betaCold = await request.get(`${url}/api/search?q=alphabarbatross`, {
      headers: { Host: `${BETA_SLUG}.localhost` },
    });
    const betaColdJson = (await betaCold.json()) as {
      results: Array<unknown>;
    };
    // Beta has no AAA token in its content. Critical: must not leak from
    // alpha's cache or from the underlying search index.
    expect(betaColdJson.results.length).toBe(0);

    // Warm: alpha again — still only alpha's content.
    const alphaWarm = await request.get(`${url}/api/search?q=alphabarbatross`, {
      headers: { Host: `${ALPHA_SLUG}.localhost` },
    });
    const alphaWarmJson = (await alphaWarm.json()) as {
      results: Array<{ slug: string }>;
    };
    expect(alphaWarmJson.results.length).toBeGreaterThan(0);
    expect(alphaWarmJson.results[0].slug).toBe("home");
  });

  test("invariant 2: header injection is overwritten", async ({
    request,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    // Hit alpha's host but try to inject beta as the active site via
    // x-site-slug. The proxy must overwrite the header and serve alpha.
    const response = await request.get(
      `${url}/api/search?q=alphabarbatross`,
      {
        headers: {
          Host: `${ALPHA_SLUG}.localhost`,
          "x-site-slug": BETA_SLUG,
        },
      },
    );
    const body = (await response.json()) as {
      results: Array<{ excerpt: string }>;
    };
    // Should still be alpha's results (AAA token present), not beta's
    // (which has no AAA token).
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].excerpt).toContain("alphabarbatross");
  });

  test("invariant 3: search ranking does not leak across sites", async ({
    request,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";

    // Both sites have the word "treatment". Each host's search should
    // return only that host's document — no rank distortion from the
    // other site's corpus.
    const alphaResults = await request.get(`${url}/api/search?q=treatment`, {
      headers: { Host: `${ALPHA_SLUG}.localhost` },
    });
    const alphaJson = (await alphaResults.json()) as {
      results: Array<{ slug: string; title: string }>;
    };
    expect(alphaJson.results.length).toBeGreaterThan(0);
    for (const r of alphaJson.results) {
      expect(r.title).toMatch(/Alpha/);
    }

    const betaResults = await request.get(`${url}/api/search?q=treatment`, {
      headers: { Host: `${BETA_SLUG}.localhost` },
    });
    const betaJson = (await betaResults.json()) as {
      results: Array<{ slug: string; title: string }>;
    };
    expect(betaJson.results.length).toBeGreaterThan(0);
    for (const r of betaJson.results) {
      expect(r.title).toMatch(/Beta/);
    }
  });
});

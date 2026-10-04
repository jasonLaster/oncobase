import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { getDocumentsByTag, listDocumentTags, listDocuments } from "../../server/document-listing";

const serviceIdentity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };
const modules = { "../documents.ts": () => import("../documents"), "../sites.ts": () => import("../sites"), "../_generated/server.js": () => import("../_generated/server") };

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const site = (slug: string) => ctx.db.insert("sites", { slug, name: slug, domains: [slug + ".test"], ownerEmail: "fixture@test.invalid", status: "active", publishTokenHash: "fixture",
      config: { passwordGate: false, enableChat: false, enableComments: false, enableDownloads: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    const alpha = await site("alpha"), beta = await site("beta");
    const doc = (siteId: typeof alpha, slug: string, title: string, tags: string[], extra: { sensitive?: boolean; deletedAt?: number } = {}) =>
      ctx.db.insert("documents", { siteId, slug, title, content: "BODY", tags, updatedAt: 1, sensitive: false, ...extra });
    return [
      await doc(alpha, "z", "Zulu", ["care", "x"]),
      await doc(alpha, "a", "Alpha", ["care"]),
      await doc(alpha, "m", "Mike", ["other"]),
      await doc(alpha, "s", "Secret", ["care"], { sensitive: true }),
      await doc(alpha, "d", "Deleted", ["care"], { deletedAt: 5 }),
      await doc(beta, "b", "Beta", ["care"]),
    ];
  });
  return { t, service: t.withIdentity(serviceIdentity), ids };
}

test("tag and corpus listings page through bounded queries with the action-era shapes", async () => {
  const { service } = await fixture();
  // pageSize 2 forces several pages, including pages with no matches.
  expect(await getDocumentsByTag(service, { siteSlug: "alpha", tag: "care" }, 2)).toEqual([
    { slug: "a", title: "Alpha", sensitive: false },
    { slug: "z", title: "Zulu", sensitive: false },
  ]);
  expect((await getDocumentsByTag(service, { siteSlug: "alpha", tag: "care", includeSensitive: true }, 2)).map(d => d.slug)).toEqual(["a", "s", "z"]);
  expect((await listDocuments(service, { siteSlug: "alpha" }, 2)).map(d => d.slug).sort()).toEqual(["a", "m", "z"]);
  expect(await listDocumentTags(service, { siteSlug: "alpha" }, 2)).toEqual(["care", "other", "x"]);
});

test("tag listing requires the service identity", async () => {
  const { t } = await fixture();
  await expect(getDocumentsByTag(t, { siteSlug: "alpha", tag: "care" })).rejects.toThrow("Unauthorized");
});

test("vector hits resolve in one tenant- and visibility-checked batch, preserving order", async () => {
  const { t, ids } = await fixture();
  const [z, a, , secret, deleted, beta] = ids;
  expect(await t.query(internal.documents.searchHitsByIds, { siteSlug: "alpha", ids: [z, beta, secret, deleted, a] })).toEqual([
    { slug: "z", title: "Zulu", tags: ["care", "x"] }, null, null, null, { slug: "a", title: "Alpha", tags: ["care"] },
  ]);
  expect((await t.query(internal.documents.searchHitsByIds, { siteSlug: "alpha", ids: [secret], includeSensitive: true }))[0]?.slug).toBe("s");
});

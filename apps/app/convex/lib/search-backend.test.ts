import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { insertDocument } from "./documentMeta";

const serviceIdentity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };
const modules = { "../documents.ts": () => import("../documents"), "../_generated/server.js": () => import("../_generated/server") };

type Extra = { sensitive?: boolean; deletedAt?: number; sizeBytes?: number };
async function fixture(docs: Array<[slug: string, content: string, extra?: Extra]>, { metaReady = true } = {}) {
  const t = convexTest(schema, modules);
  const siteId = await t.run(async ctx => {
    const siteId = await ctx.db.insert("sites", { slug: "alpha", name: "Alpha", domains: [], ownerEmail: "fixture@test.invalid", status: "active", publishTokenHash: "fixture",
      config: { passwordGate: false, enableChat: false, enableComments: false, enableDownloads: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
      ...(metaReady ? { documentMetaReadyAt: 1 } : {}) });
    for (const [slug, content, extra = {}] of docs) {
      // Legacy rows omit `sensitive`; writers always store a boolean.
      await insertDocument(ctx, { siteId, slug, title: slug, content, tags: [], updatedAt: 1, ...extra });
    }
    return siteId;
  });
  return { t, siteId, service: t.withIdentity(serviceIdentity) };
}

test("indexed search never spends result slots or reads on restricted or deleted rows", async () => {
  const { service } = await fixture([
    ...Array.from({ length: 6 }, (_, index): [string, string, Extra] => [`restricted-${index}`, "needle", { sensitive: true }]),
    ...Array.from({ length: 6 }, (_, index): [string, string, Extra] => [`deleted-${index}`, "needle", { deletedAt: 5, sensitive: false }]),
    ["public", "needle", { sensitive: false }],
    ["legacy-unset", "needle"],
    ["legacy-zero", "needle", { deletedAt: 0, sensitive: false }],
    ["legacy-zero-restricted", "needle", { deletedAt: 0, sensitive: true }],
  ]);
  const slugs = async (args: { limit?: number; includeSensitive?: boolean }) =>
    (await service.query(api.documents.search, { siteSlug: "alpha", query: "needle", ...args })).map(result => result.slug).sort();
  expect(await slugs({ limit: 3 })).toEqual(["legacy-unset", "legacy-zero", "public"]);
  expect(await slugs({ limit: 1 })).toHaveLength(1);
  const session = await slugs({ limit: 20, includeSensitive: true });
  expect(session).toEqual([...Array.from({ length: 6 }, (_, index) => `restricted-${index}`), "legacy-unset", "legacy-zero", "legacy-zero-restricted", "public"].sort());
});

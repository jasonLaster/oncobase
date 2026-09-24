import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api } from "../_generated/api";
import schema from "../schema";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { hashDocument } from "../../../../packages/oncobase/src/walk-vault";

test("publisher state verifies actual raw content, preserves tenants/tombstones, and returns no bodies", async () => {
  const unauthed = convexTest(schema, {
    "../documents.ts": () => import("../documents"),
    "../_generated/server.js": () => import("../_generated/server"),
  });
  const t = unauthed.withIdentity({ issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" });
  const doc = { title: "fixture", content: "PRIVATE_RAW_BODY", tags: ["test"], sensitive: true, sensitiveInclude: ["team"] };
  const hash = hashDocument(doc);
  await t.run(async ctx => {
    const makeSite = (slug: string) => ctx.db.insert("sites", {
      slug, name: slug, ownerEmail: "fixture@example.test", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false, piiPatterns: ["/PRIVATE_RAW_BODY/g=>REDACTED_BODY"] },
      quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1,
    });
    const a = await makeSite("alpha"), b = await makeSite("beta");
    const stored = { ...doc, rawContent: doc.content, content: "REDACTED_BODY", contentHash: hash, updatedAt: 1, siteId: a };
    await ctx.db.insert("documents", { ...stored, slug: "valid" });
    await ctx.db.insert("documents", { ...stored, slug: "corrupt", rawContent: "different" });
    await ctx.db.insert("documents", { ...stored, slug: "large", rawContent: undefined });
    await ctx.db.insert("documents", { ...stored, slug: "deleted", deletedAt: 1 });
    await ctx.db.insert("documents", { ...stored, slug: "other", siteId: b });
    await ctx.db.insert("fileAssets", { siteId: a, path: "shared.png", blobUrl: "https://example.test/file", sizeBytes: 12, uploadedAt: 1,
      contentHash: "asset-hash", ownerSlugs: ["valid"], sensitive: true, sensitiveInclude: ["team"], visibilityHash: "incorrect" });
  });
  const args = { siteSlug: "alpha", slugs: ["valid", "corrupt", "large", "deleted", "other", "missing"], assets: [{ path: "shared.png", kind: "file" as const }] };
  await expect(unauthed.query(api.documents.publisherState, args)).rejects.toThrow("Unauthorized");
  const state = await t.query(api.documents.publisherState, args);
  expect(state.documents[0].observedHash).toBe(hash);
  expect(state.documents[0].readerContentConsistent).toBe(true);
  expect(state.documents[1].readerContentConsistent).toBe(false);
  expect(state.documents[1].observedHash).not.toBe(hash);
  expect(state.documents[2].observedHash).toBeNull();
  expect(state.documents.slice(3).every(doc => !doc.exists)).toBe(true);
  expect(state.assets[0].observedVisibilityHash).not.toBe("incorrect");
  expect(state.assets[0].hasVisibility).toBe(true);
  expect(JSON.stringify(state)).not.toContain("PRIVATE_RAW_BODY");
  expect(JSON.stringify(state)).not.toContain("REDACTED_BODY");
  expect(JSON.stringify(state)).not.toContain("https://");
  await expect(t.query(api.documents.publisherState, { ...args, slugs: Array(17).fill("valid") })).rejects.toThrow("exceeds limit");
});

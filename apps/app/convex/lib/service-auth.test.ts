import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { conversationGateVersion } from "./conversationAuth";
import * as conversations from "../conversations";
import * as documents from "../documents";
import * as sites from "../sites";
import * as users from "../users";
import * as access from "../access";
import * as dicom from "../dicom";
import * as epicFhir from "../epicFhir";
import * as imageAnnotations from "../imageAnnotations";
import * as commentRooms from "../commentRooms";
import * as guestNames from "../guestNames";
import * as migrations from "../migrations";

export const serviceIdentity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };
const modules = { "../conversations.ts": () => import("../conversations"), "../documents.ts": () => import("../documents"), "../sites.ts": () => import("../sites"), "../users.ts": () => import("../users"),
  "../_generated/server.js": () => import("../_generated/server") };

test("every server-only public handler denies before reading or mutating data", async () => {
  let checked = 0;
  for (const module of [documents, sites, users, access, dicom, epicFhir, imageAnnotations, commentRooms, guestNames, migrations, conversations]) {
    for (const exported of Object.values(module)) {
      const fn = exported as { isPublic?: boolean; _handler?: (ctx: unknown, args: unknown) => unknown };
      if (!fn.isPublic || !fn._handler) continue;
      for (const identity of [null, { ...serviceIdentity, issuer: "https://untrusted.test" }, { ...serviceIdentity, subject: "browser" }, { ...serviceIdentity, role: "reader" }]) {
        let reads = 0;
        const ctx = { auth: { getUserIdentity: async () => identity }, get db() { reads++; throw new Error("Data accessed before authorization"); } };
        await expect(Promise.resolve().then(() => fn._handler!(ctx, {}))).rejects.toThrow("Unauthorized");
        expect(reads).toBe(0);
      }
      checked++;
    }
  }
  expect(checked).toBe(117);
});

test("direct reader, legacy bulk reads, sensitive flag and hash lookups require a verified service identity", async () => {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    const siteId = await ctx.db.insert("sites", { slug: "alpha", name: "Alpha", domains: ["alpha.test"], ownerEmail: "fixture@test.invalid", status: "active", publishTokenHash: "not-a-real-token",
      config: { passwordGate: true, passwordHash: "not-a-real-password-hash", enableChat: false, enableComments: false, enableDownloads: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    for (const sensitive of [false, true]) await ctx.db.insert("documents", { siteId, slug: sensitive ? "restricted" : "index", title: "Fixture", content: sensitive ? "RESTRICTED_FIXTURE" : "PUBLIC_FIXTURE", rawContent: "RAW_FIXTURE", contentHash: "fixture-hash", tags: [], sensitive, updatedAt: 1 });
  });
  await expect(t.query(api.documents.getReaderPolicy, { host: "alpha.test" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.documents.getReaderPage, { host: "alpha.test", slug: "index" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.documents.getBySlug, { siteSlug: "alpha", slug: "restricted", includeSensitive: true, rawContentSessionTokenHash: "forged" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.documents.listPageWithContent, { siteSlug: "alpha", cursor: null, numItems: 10, includeSensitive: true })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.sites.getBySlug, { slug: "alpha" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.sites.getByHost, { host: "alpha.test" })).rejects.toThrow("Unauthorized");
  await expect(t.query(api.users.getByEmailForAuth, { siteSlug: "alpha", email: "fixture@test.invalid" })).rejects.toThrow("Unauthorized");
  const service = t.withIdentity(serviceIdentity);
  expect((await service.query(api.documents.getReaderPage, { host: "alpha.test", slug: "index" }))?.page?.content).toBe("PUBLIC_FIXTURE");
  expect((await service.query(api.documents.getReaderPage, { host: "alpha.test", slug: "restricted" }))?.page).toBeNull();
  expect((await service.query(api.documents.getBySlug, { siteSlug: "alpha", slug: "index" }))?.content).not.toBe("RAW_FIXTURE");
  const site = await service.query(api.sites.getBySlug, { slug: "alpha" });
  const browserIdentity = { issuer: SERVICE_ISSUER, subject: "wiki-browser:alpha", role: "wiki-conversations", siteSlug: "alpha", gateVersion: conversationGateVersion(site!) };
  const browser = t.withIdentity(browserIdentity);
  expect(await browser.query(api.conversations.list, { siteSlug: "alpha" })).toEqual([]);
  await expect(browser.query(api.documents.getReaderPage, { host: "alpha.test", slug: "index" })).rejects.toThrow("Unauthorized");
  await expect(browser.query(api.sites.getBySlug, { slug: "alpha" })).rejects.toThrow("Unauthorized");
  await expect(browser.query(api.conversations.list, { siteSlug: "beta" })).rejects.toThrow("Unauthorized");
  await t.run(ctx => ctx.db.patch(site!._id, { config: { ...site!.config, passwordHash: "rotated-fixture" } }));
  await expect(browser.query(api.conversations.list, { siteSlug: "alpha" })).rejects.toThrow("Unauthorized");
  const manifest = await t.query(internal.documents.internal_listManifestPage, { siteSlug: "alpha", cursor: null, numItems: 10 });
  expect(manifest.page.map(p => p.slug)).toEqual(["index"]);
});

import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { countRedactionMarkup } from "../adminStats";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

const serviceIdentity = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };

const modules = { "../adminStats.ts": () => import("../adminStats"), "../_generated/server.js": () => import("../_generated/server") };

test("redaction markup counts blocks and inline tags", () => {
  expect(countRedactionMarkup("plain [redacted email] text")).toBe(0);
  expect(countRedactionMarkup(":::redact [Names]\nsecret\n:::\nand <redact fallback=\"x\">y</redact> <REDACT>z</REDACT>")).toBe(3);
});

test("redaction scan stays inside its prefix and site, and counts the author's source", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const site = (slug: string) => ctx.db.insert("sites", { slug, name: slug, ownerEmail: "owner@test.invalid", status: "active", domains: [], publishTokenHash: "fixture",
      config: { enableChat: false, enableComments: false, enableDownloads: false, passwordGate: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    const alpha = await site("alpha");
    const beta = await site("beta");
    const doc = (siteId: typeof alpha, slug: string, rawContent: string, extra = {}) => ctx.db.insert("documents", { siteId, slug, title: slug, content: "reader copy", rawContent, tags: [], updatedAt: 1, ...extra });
    await doc(alpha, "sources/meeting-notes/04-01---a-raw", ":::redact\nx\n:::", { sensitive: true });
    await doc(alpha, "sources/meeting-notes/04-01---a-formatted", "nothing hidden");
    await doc(alpha, "sources/meeting-notes/04-02---gone-raw", "<redact>x</redact>", { deletedAt: 5 });
    await doc(alpha, "sources/meeting-notes-archive/x", "<redact>x</redact>");
    await doc(beta, "sources/meeting-notes/04-03---other-raw", "<redact>x</redact>");
    await ctx.db.insert("commentRooms", { siteId: alpha, roomId: "r1", threadCount: 3, updatedAt: 1 });
    await ctx.db.insert("commentRooms", { siteId: alpha, roomId: "r2", threadCount: 2, updatedAt: 1 });
    await ctx.db.insert("commentRooms", { siteId: beta, roomId: "r3", threadCount: 9, updatedAt: 1 });
  });
  const args = { siteSlug: "alpha", prefix: "sources/meeting-notes/", cursor: null, numItems: 25 };
  await expect(t.query(api.adminStats.redactionPage, args)).rejects.toThrow("Unauthorized");
  const service = t.withIdentity(serviceIdentity);
  const result = await service.query(api.adminStats.redactionPage, args);
  expect(result.page).toEqual([
    { slug: "sources/meeting-notes/04-01---a-formatted", sensitive: false, redactions: 0 },
    { slug: "sources/meeting-notes/04-01---a-raw", sensitive: true, redactions: 1 },
  ]);
  expect((await service.query(api.adminStats.redactionPage, { ...args, prefix: "sources/meeting-notes" })).page).toEqual([]);
  const rooms = await service.query(api.adminStats.countPage, { siteSlug: "alpha", table: "commentRooms", cursor: null, numItems: 100 });
  expect({ count: rooms.count, threads: rooms.threads, isDone: rooms.isDone }).toEqual({ count: 2, threads: 5, isDone: true });
});

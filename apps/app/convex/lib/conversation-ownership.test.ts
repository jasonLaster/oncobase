import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";
import { conversationGateVersion, conversationOwnerKey } from "./conversationAuth";

const modules = { "../conversations.ts": () => import("../conversations"), "../sites.ts": () => import("../sites"),
  "../_generated/server.js": () => import("../_generated/server") };
const service = { issuer: SERVICE_ISSUER, subject: SERVICE_SUBJECT, role: "backend-service" };
const alice = conversationOwnerKey("alpha", "anon:alice-cookie");
const bob = conversationOwnerKey("alpha", "user:bob");

async function fixture() {
  const t = convexTest(schema, modules);
  const site = await t.run(async ctx => {
    const siteId = await ctx.db.insert("sites", { slug: "alpha", name: "Alpha", domains: ["alpha.test"], ownerEmail: "fixture@test.invalid", status: "active", publishTokenHash: "not-a-real-token",
      config: { passwordGate: true, passwordHash: "fixture-gate", enableChat: true, enableComments: false, enableDownloads: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    return (await ctx.db.get(siteId))!;
  });
  const browser = (ownerKey?: string) => t.withIdentity({ issuer: SERVICE_ISSUER, subject: "wiki-browser:alpha", role: "wiki-conversations", siteSlug: "alpha",
    gateVersion: conversationGateVersion(site), ...(ownerKey ? { ownerKey } : {}) });
  return { t, site, browser };
}

test("browser owners only see, read and delete their own conversations", async () => {
  const { t, browser } = await fixture();
  const asAlice = browser(alice), asBob = browser(bob);
  const conversationId = await asAlice.mutation(api.conversations.create, { siteSlug: "alpha", title: "Alice question" });
  await asAlice.mutation(api.conversations.sendMessage, { siteSlug: "alpha", conversationId, text: "ALICE_PRIVATE" });
  // eslint-disable-next-line no-restricted-syntax -- Test fixture reads the single message it just wrote.
  const [message] = await t.run(ctx => ctx.db.query("messages").collect());

  expect((await asAlice.query(api.conversations.list, { siteSlug: "alpha" })).map(c => c._id)).toEqual([conversationId]);
  expect((await asAlice.query(api.conversations.get, { siteSlug: "alpha", id: conversationId }))?.messages.map(m => m.content)).toEqual(["ALICE_PRIVATE"]);

  expect(await asBob.query(api.conversations.list, { siteSlug: "alpha" })).toEqual([]);
  expect(await asBob.query(api.conversations.get, { siteSlug: "alpha", id: conversationId })).toBeNull();
  expect(await asBob.query(api.conversations.getMessages, { siteSlug: "alpha", id: conversationId })).toEqual([]);
  expect(await asBob.query(api.conversations.getMeta, { siteSlug: "alpha", id: conversationId })).toBeNull();
  expect(await asBob.query(api.conversations.getStreamingState, { siteSlug: "alpha", id: conversationId })).toBeNull();
  expect(await asBob.query(api.conversations.getCancelState, { siteSlug: "alpha", conversationId })).toBeNull();
  // A browser cannot claim another owner through the argument.
  expect(await asBob.query(api.conversations.get, { siteSlug: "alpha", id: conversationId, ownerKey: alice })).toBeNull();
  expect(await asBob.mutation(api.conversations.remove, { siteSlug: "alpha", id: conversationId })).toEqual({ deleted: false });
  await asBob.mutation(api.conversations.archive, { siteSlug: "alpha", id: conversationId });
  await asBob.mutation(api.conversations.sendMessage, { siteSlug: "alpha", conversationId, text: "BOB_INJECTED" });
  await asBob.mutation(api.conversations.disableMessage, { siteSlug: "alpha", id: message!._id });
  await asBob.mutation(api.conversations.cancelStream, { siteSlug: "alpha", conversationId });

  const untouched = await asAlice.query(api.conversations.get, { siteSlug: "alpha", id: conversationId });
  expect(untouched?.archived).toBeUndefined();
  expect(untouched?.canceledAt).toBeUndefined();
  expect(untouched?.messages.map(m => [m.content, m.disabled])).toEqual([["ALICE_PRIVATE", undefined]]);

  expect(await asAlice.mutation(api.conversations.remove, { siteSlug: "alpha", id: conversationId })).toEqual({ deleted: true, deletedMessages: 1 });
  expect(await asAlice.query(api.conversations.list, { siteSlug: "alpha" })).toEqual([]);
});

test("legacy unowned conversations and owner-less browser tokens are inaccessible to browsers", async () => {
  const { t, site, browser } = await fixture();
  const legacy = await t.run(ctx => ctx.db.insert("conversations", { siteId: site._id, title: "Legacy", createdAt: 1, updatedAt: 1 }));
  const asAlice = browser(alice);
  expect(await asAlice.query(api.conversations.list, { siteSlug: "alpha" })).toEqual([]);
  expect(await asAlice.query(api.conversations.get, { siteSlug: "alpha", id: legacy })).toBeNull();
  expect(await asAlice.mutation(api.conversations.remove, { siteSlug: "alpha", id: legacy })).toEqual({ deleted: false });

  // Tokens minted by an app server from before owner claims see nothing and cannot create orphans.
  const ownerless = browser();
  expect(await ownerless.query(api.conversations.list, { siteSlug: "alpha" })).toEqual([]);
  expect(await ownerless.query(api.conversations.get, { siteSlug: "alpha", id: legacy })).toBeNull();
  await expect(ownerless.mutation(api.conversations.create, { siteSlug: "alpha", title: "x" })).rejects.toThrow("Unauthorized");
  expect(await browser("not-a-hash").query(api.conversations.list, { siteSlug: "alpha" })).toEqual([]);

  // A server call that omits its owner fails closed: there is no site-wide view.
  const asService = t.withIdentity(service);
  await expect(asService.query(api.conversations.get, { siteSlug: "alpha", id: legacy })).rejects.toThrow("Unauthorized");
  await expect(asService.query(api.conversations.list, { siteSlug: "alpha" })).rejects.toThrow("Unauthorized");
  await expect(asService.mutation(api.conversations.remove, { siteSlug: "alpha", id: legacy })).rejects.toThrow("Unauthorized");
  await expect(asService.query(api.conversations.get, { siteSlug: "alpha", id: legacy, ownerKey: "not-a-hash" })).rejects.toThrow("Unauthorized");
  // With an explicit owner it still only sees that owner's rows, never the unowned legacy row.
  expect(await asService.query(api.conversations.get, { siteSlug: "alpha", id: legacy, ownerKey: "a".repeat(64) })).toBeNull();
});

test("server writes on behalf of an owner cannot touch another owner's conversation", async () => {
  const { t, browser } = await fixture();
  const asService = t.withIdentity(service);
  const conversationId = await browser(alice).mutation(api.conversations.create, { siteSlug: "alpha", title: "Alice" }) as Id<"conversations">;
  const saved = (ownerKey: string, content: string) => asService.mutation(api.conversations.saveMessages, { siteSlug: "alpha", ownerKey, conversationId,
    messages: [{ role: "assistant", content, createdAt: 2 }] });

  await asService.mutation(api.conversations.beginRun, { siteSlug: "alpha", ownerKey: bob, conversationId, runId: "run-bob" });
  await saved(bob, "SENSITIVE_FOR_BOB");
  expect(await asService.query(api.conversations.getCancelState, { siteSlug: "alpha", ownerKey: bob, conversationId })).toBeNull();
  let state = await t.run(ctx => ctx.db.get(conversationId));
  expect(state?.activeRunId).toBeUndefined();

  await asService.mutation(api.conversations.beginRun, { siteSlug: "alpha", ownerKey: alice, conversationId, runId: "run-alice" });
  await saved(alice, "ANSWER_FOR_ALICE");
  state = await t.run(ctx => ctx.db.get(conversationId));
  expect(state?.activeRunId).toBe("run-alice");
  expect((await browser(alice).query(api.conversations.getMessages, { siteSlug: "alpha", id: conversationId })).map(m => m.content)).toEqual(["ANSWER_FOR_ALICE"]);

  // Server-created conversations carry the explicit owner; malformed owners are refused.
  const created = await asService.mutation(api.conversations.create, { siteSlug: "alpha", ownerKey: bob, title: "Bob" });
  expect((await browser(bob).query(api.conversations.list, { siteSlug: "alpha" })).map(c => c._id)).toEqual([created]);
  await expect(asService.query(api.conversations.list, { siteSlug: "alpha", ownerKey: "nope" })).rejects.toThrow("Unauthorized");
});

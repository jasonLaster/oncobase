/* eslint-disable no-restricted-syntax -- Fixtures inspect whole tables to prove which rows survive. */
import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import { PURGE_BATCH_SIZE } from "../cleanup";

const modules = { "../cleanup.ts": () => import("../cleanup"), "../_generated/server.js": () => import("../_generated/server") };

test("expired sessions and OAuth states are purged in bounded batches; live rows stay", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async ctx => {
    const siteId = await ctx.db.insert("sites", { slug: "alpha", name: "Alpha", domains: [], ownerEmail: "fixture@test.invalid", status: "active", publishTokenHash: "fixture",
      config: { passwordGate: false, enableChat: false, enableComments: false, enableDownloads: false }, quotas: { monthlyOpenAITokens: 0, blobBytes: 0 }, createdAt: 1, updatedAt: 1 });
    const userId = await ctx.db.insert("users", { siteId, email: "a@test.invalid", passwordHash: "h", passwordSalt: "s", createdAt: 1, updatedAt: 1 });
    for (let i = 0; i < PURGE_BATCH_SIZE + 5; i++) await ctx.db.insert("userSessions", { siteId, userId, tokenHash: `old-${i}`, createdAt: 1, expiresAt: now - 1_000 - i });
    await ctx.db.insert("userSessions", { siteId, userId, tokenHash: "live", createdAt: 1, expiresAt: now + 60_000 });
    const state = { siteId, providerKey: "epic", redirectUri: "https://x.invalid", codeVerifierCiphertext: "c", fhirBaseUrl: "https://x.invalid", authorizationEndpoint: "https://x.invalid", tokenEndpoint: "https://x.invalid", scopes: [], createdAt: 1 };
    await ctx.db.insert("epicFhirOAuthStates", { ...state, stateHash: "expired", expiresAt: now - 1 });
    await ctx.db.insert("epicFhirOAuthStates", { ...state, stateHash: "pending", expiresAt: now + 600_000 });
  });

  expect(await t.mutation(internal.cleanup.purgeExpiredSessions, {})).toEqual({ deleted: PURGE_BATCH_SIZE });
  // A full batch schedules the next one immediately.
  expect((await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).filter(job => job.name.includes("purgeExpiredSessions"))).toHaveLength(1);
  expect(await t.mutation(internal.cleanup.purgeExpiredSessions, { batches: 1 })).toEqual({ deleted: 5 });
  expect((await t.run(ctx => ctx.db.query("userSessions").collect())).map(row => row.tokenHash)).toEqual(["live"]);

  expect(await t.mutation(internal.cleanup.purgeExpiredOAuthStates, {})).toEqual({ deleted: 1 });
  expect((await t.run(ctx => ctx.db.query("epicFhirOAuthStates").collect())).map(row => row.stateHash)).toEqual(["pending"]);
  expect((await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).filter(job => job.name.includes("OAuthStates"))).toHaveLength(0);
});

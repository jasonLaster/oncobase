import { expect, spyOn, test } from "bun:test";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { SERVICE_ISSUER, SERVICE_SUBJECT } from "./serviceAuth";

const modules = {
  "../wikiEdits.ts": () => import("../wikiEdits"),
  "../_generated/server.js": () => import("../_generated/server"),
};

async function fixture() {
  const anonymous = convexTest(schema, modules);
  const t = anonymous.withIdentity({
    issuer: SERVICE_ISSUER,
    subject: SERVICE_SUBJECT,
    role: "backend-service",
  });
  const ids = await t.run(async (ctx) => {
    const mkSite = (slug: string) =>
      ctx.db.insert("sites", {
        slug,
        name: slug,
        ownerEmail: "owner@test.invalid",
        status: "active",
        domains: [],
        publishTokenHash: "fixture",
        config: {
          enableChat: true,
          enableComments: false,
          enableDownloads: false,
          passwordGate: true,
        },
        quotas: { monthlyOpenAITokens: 0, blobBytes: 0 },
        createdAt: 1,
        updatedAt: 1,
      });
    const alpha = await mkSite("alpha");
    const beta = await mkSite("beta");
    const mkUser = (siteId: typeof alpha, email: string) =>
      ctx.db.insert("users", {
        siteId,
        email,
        name: email.split("@")[0],
        passwordHash: "fixture",
        passwordSalt: "fixture",
        createdAt: 1,
        updatedAt: 1,
      });
    const owner = await mkUser(alpha, "owner@test.invalid");
    const reader = await mkUser(alpha, "reader@test.invalid");
    const admin = await mkUser(alpha, "admin@test.invalid");
    const betaOwner = await mkUser(beta, "owner@test.invalid");

    const adminRole = await ctx.db.insert("roles", {
      siteId: alpha,
      name: "Admin",
      createdAt: 1,
      updatedAt: 1,
    });
    const adminAssignment = await ctx.db.insert("userRoles", {
      siteId: alpha,
      userId: admin,
      roleId: adminRole,
      createdAt: 1,
    });

    const mkSession = (siteId: typeof alpha, userId: typeof owner, tokenHash: string) =>
      ctx.db.insert("userSessions", {
        siteId,
        userId,
        tokenHash,
        createdAt: 1,
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
    const ownerSession = await mkSession(alpha, owner, "owner-session");
    await mkSession(alpha, reader, "reader-session");
    await mkSession(alpha, admin, "admin-session");
    await mkSession(beta, betaOwner, "beta-owner-session");
    return { alpha, beta, owner, reader, admin, adminAssignment, ownerSession };
  });

  const baseProposal = {
    siteSlug: "alpha",
    sessionTokenHash: "owner-session",
    ownerKey: "owner-key-1",
    slug: "wiki/treatment/plan",
    title: "Treatment Plan",
    filePath: "wiki/treatment/plan.md",
    branch: "main",
    baseFileSha: "sha-base-1",
    baseContentHash: "0123456789abcdef",
    sensitive: false,
    readSensitiveInSession: false,
    edits: [{ oldText: "old text", newText: "new text" }],
    summary: "Clarify schedule",
    commitMessage: "Update treatment plan",
    redactedDiff: "@@ -1,1 +1,1 @@\n-old text\n+new text",
    stats: { additions: 1, deletions: 1 },
  };
  return { t, anonymous, ids, baseProposal };
}

test("editor authorization enforces site isolation, admin role, and revocation", async () => {
  const { t, ids, baseProposal } = await fixture();

  expect(
    await t.query(api.wikiEdits.isSiteEditor, {
      siteSlug: "alpha",
      sessionTokenHash: "owner-session",
    }),
  ).toMatchObject({ canEdit: true, email: "owner@test.invalid" });
  expect(
    await t.query(api.wikiEdits.isSiteEditor, {
      siteSlug: "alpha",
      sessionTokenHash: "admin-session",
    }),
  ).toMatchObject({ canEdit: true, email: "admin@test.invalid" });
  expect(
    await t.query(api.wikiEdits.isSiteEditor, {
      siteSlug: "alpha",
      sessionTokenHash: "reader-session",
    }),
  ).toEqual({ canEdit: false });
  expect(
    await t.query(api.wikiEdits.isSiteEditor, {
      siteSlug: "alpha",
      sessionTokenHash: "beta-owner-session",
    }),
  ).toEqual({ canEdit: false });

  await expect(
    t.mutation(api.wikiEdits.createProposal, {
      ...baseProposal,
      sessionTokenHash: "reader-session",
    }),
  ).rejects.toThrow("Forbidden");

  const { proposalId } = await t.mutation(api.wikiEdits.createProposal, {
    ...baseProposal,
    sessionTokenHash: "admin-session",
    ownerKey: "admin-owner-key",
  });

  // Wrong site or wrong ownerKey cannot read or claim the proposal.
  expect(
    await t.query(api.wikiEdits.getProposal, {
      siteSlug: "beta",
      sessionTokenHash: "beta-owner-session",
      ownerKey: "admin-owner-key",
      proposalId,
    }),
  ).toBeNull();
  expect(
    await t.query(api.wikiEdits.getProposal, {
      siteSlug: "alpha",
      sessionTokenHash: "owner-session",
      ownerKey: "different-owner",
      proposalId,
    }),
  ).toBeNull();

  // Revoking Admin role immediately blocks claiming the existing proposal.
  await t.run((ctx) => ctx.db.delete(ids.adminAssignment));
  await expect(
    t.mutation(api.wikiEdits.claimForExecution, {
      siteSlug: "alpha",
      sessionTokenHash: "admin-session",
      ownerKey: "admin-owner-key",
      proposalId,
      executionId: "exec-1",
    }),
  ).rejects.toThrow("Forbidden");
});

test("atomic claim prevents double execution and supports commit/publish/retry transitions", async () => {
  const { t, baseProposal } = await fixture();
  const { proposalId } = await t.mutation(api.wikiEdits.createProposal, baseProposal);

  const claim = await t.mutation(api.wikiEdits.claimForExecution, {
    siteSlug: "alpha",
    sessionTokenHash: "owner-session",
    ownerKey: "owner-key-1",
    proposalId,
    executionId: "exec-1",
  });
  expect(claim.proposal.status).toBe("executing");

  // Concurrent second claim while lease is live must be rejected.
  await expect(
    t.mutation(api.wikiEdits.claimForExecution, {
      siteSlug: "alpha",
      sessionTokenHash: "owner-session",
      ownerKey: "owner-key-1",
      proposalId,
      executionId: "exec-2",
    }),
  ).rejects.toThrow("Already executing");

  // Record Git commit immediately before Convex publish.
  await t.mutation(api.wikiEdits.recordCommit, {
    siteSlug: "alpha",
    proposalId,
    executionId: "exec-1",
    commitSha: "abc1234",
    commitUrl: "https://github.com/org/repo/commit/abc1234",
  });

  // Wrong executionId cannot mutate state.
  await expect(
    t.mutation(api.wikiEdits.markPendingPublish, {
      siteSlug: "alpha",
      proposalId,
      executionId: "exec-wrong",
      error: "publish already running",
    }),
  ).rejects.toThrow("Execution mismatch");

  // Busy site lease moves to committed_pending_publish so it can be retried.
  const pending = await t.mutation(api.wikiEdits.markPendingPublish, {
    siteSlug: "alpha",
    proposalId,
    executionId: "exec-1",
    error: "publish already running",
  });
  expect(pending.status).toBe("committed_pending_publish");
  expect(pending.commitSha).toBe("abc1234");

  const stuck = await t.query(api.wikiEdits.listStuckExecutions, { siteSlug: "alpha" });
  expect(stuck.map((p) => p._id)).toEqual([proposalId]);

  // Retry claim succeeds and finishes as published.
  await t.mutation(api.wikiEdits.claimForExecution, {
    siteSlug: "alpha",
    sessionTokenHash: "owner-session",
    ownerKey: "owner-key-1",
    proposalId,
    executionId: "exec-2",
  });
  const published = await t.mutation(api.wikiEdits.markPublished, {
    siteSlug: "alpha",
    proposalId,
    executionId: "exec-2",
    publishedRevision: 42,
  });
  expect(published.status).toBe("published");
  expect(published.publishedRevision).toBe(42);

  // Published proposals cannot be claimed again.
  await expect(
    t.mutation(api.wikiEdits.claimForExecution, {
      siteSlug: "alpha",
      sessionTokenHash: "owner-session",
      ownerKey: "owner-key-1",
      proposalId,
      executionId: "exec-3",
    }),
  ).rejects.toThrow("Already published");
});

test("expired proposals cannot be claimed and pending proposals can be rejected", async () => {
  const { t, baseProposal } = await fixture();
  const { proposalId: p1 } = await t.mutation(api.wikiEdits.createProposal, baseProposal);
  const rejected = await t.mutation(api.wikiEdits.rejectProposal, {
    siteSlug: "alpha",
    sessionTokenHash: "owner-session",
    ownerKey: "owner-key-1",
    proposalId: p1,
  });
  expect(rejected.status).toBe("rejected");

  const { proposalId: p2 } = await t.mutation(api.wikiEdits.createProposal, baseProposal);
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
  try {
    await expect(
      t.mutation(api.wikiEdits.claimForExecution, {
        siteSlug: "alpha",
        sessionTokenHash: "owner-session",
        ownerKey: "owner-key-1",
        proposalId: p2,
        executionId: "exec-expired",
      }),
    ).rejects.toThrow("Proposal expired");
  } finally {
    clock.mockRestore();
  }
});

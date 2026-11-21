/* eslint-disable no-restricted-syntax -- All indexed reads require a resolved siteId. */
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./lib/serviceFunctions";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";

export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;
export const EXECUTION_LEASE_MS = 90 * 1000;

type AnyCtx = QueryCtx | MutationCtx;

/**
 * Indexed owner/admin session check executed inside the same Convex transaction
 * as proposal creation, reads, and atomic execution claims. Mirrors
 * `pageShares.ts:requireManager`.
 */
async function resolveEditor(ctx: AnyCtx, site: SiteCtx, sessionTokenHash: string): Promise<Doc<"users"> | null> {
  if (!site.siteId || !site.site || !sessionTokenHash) return null;
  const session = await ctx.db
    .query("userSessions")
    .withIndex("by_site_token", (q) =>
      q.eq("siteId", site.siteId!).eq("tokenHash", sessionTokenHash),
    )
    .first();
  if (!session || session.expiresAt <= Date.now()) return null;
  const user = await ctx.db.get(session.userId);
  if (!user || !rowBelongsToSite(user, site)) return null;
  if (user.email.toLowerCase() === site.site.ownerEmail.toLowerCase()) return user;
  const assignments = await ctx.db
    .query("userRoles")
    .withIndex("by_site_user", (q) =>
      q.eq("siteId", site.siteId!).eq("userId", user._id),
    )
    .collect();
  for (const assignment of assignments) {
    const role = await ctx.db.get(assignment.roleId);
    if (role && rowBelongsToSite(role, site) && role.name.trim().toLowerCase() === "admin") {
      return user;
    }
  }
  return null;
}

async function requireEditor(ctx: AnyCtx, site: SiteCtx, sessionTokenHash: string): Promise<Doc<"users">> {
  const user = await resolveEditor(ctx, site, sessionTokenHash);
  if (!user) throw new ConvexError("Forbidden");
  return user;
}

function projectProposal(doc: Doc<"wikiEditProposals">, now: number) {
  const effectiveStatus =
    doc.status === "pending" && doc.expiresAt <= now ? ("expired" as const) : doc.status;
  return {
    _id: doc._id,
    slug: doc.slug,
    title: doc.title,
    filePath: doc.filePath,
    branch: doc.branch,
    baseFileSha: doc.baseFileSha,
    baseContentHash: doc.baseContentHash,
    sensitive: doc.sensitive,
    readSensitiveInSession: doc.readSensitiveInSession,
    edits: doc.edits,
    summary: doc.summary,
    commitMessage: doc.commitMessage,
    redactedDiff: doc.redactedDiff,
    stats: doc.stats,
    status: effectiveStatus,
    commitSha: doc.commitSha,
    commitUrl: doc.commitUrl,
    publishedRevision: doc.publishedRevision,
    error: doc.error,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    expiresAt: doc.expiresAt,
  };
}

export const isSiteEditor = query({
  args: { siteSlug: v.string(), sessionTokenHash: v.string() },
  handler: async (ctx, { siteSlug, sessionTokenHash }) => {
    const site = await requireSite(ctx, siteSlug);
    const user = await resolveEditor(ctx, site, sessionTokenHash);
    if (!user) return { canEdit: false as const };
    return {
      canEdit: true as const,
      userId: user._id,
      email: user.email,
      name: user.name ?? null,
      manifestRevision: site.site?.manifestRevision ?? 0,
    };
  },
});

export const createProposal = mutation({
  args: {
    siteSlug: v.string(),
    sessionTokenHash: v.string(),
    ownerKey: v.string(),
    conversationId: v.optional(v.string()),
    slug: v.string(),
    title: v.string(),
    filePath: v.string(),
    branch: v.string(),
    baseFileSha: v.string(),
    baseContentHash: v.string(),
    sensitive: v.boolean(),
    readSensitiveInSession: v.boolean(),
    edits: v.array(v.object({ oldText: v.string(), newText: v.string() })),
    summary: v.string(),
    commitMessage: v.string(),
    redactedDiff: v.string(),
    stats: v.object({ additions: v.number(), deletions: v.number() }),
  },
  handler: async (ctx, args) => {
    const site = await requireSite(ctx, args.siteSlug);
    if (!site.siteId) throw new ConvexError("Forbidden");
    const user = await requireEditor(ctx, site, args.sessionTokenHash);

    const conversationId = args.conversationId?.trim() || undefined;

    const now = Date.now();
    const id = await ctx.db.insert("wikiEditProposals", {
      siteId: site.siteId,
      ...(conversationId ? { conversationId } : {}),
      ownerKey: args.ownerKey,
      createdByUserId: user._id,
      slug: args.slug,
      title: args.title,
      filePath: args.filePath,
      branch: args.branch,
      baseFileSha: args.baseFileSha,
      baseContentHash: args.baseContentHash,
      sensitive: args.sensitive,
      readSensitiveInSession: args.readSensitiveInSession,
      edits: args.edits,
      summary: args.summary,
      commitMessage: args.commitMessage,
      redactedDiff: args.redactedDiff,
      stats: args.stats,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + PROPOSAL_TTL_MS,
    });
    return { proposalId: id, expiresAt: now + PROPOSAL_TTL_MS };
  },
});

export const getProposal = query({
  args: {
    siteSlug: v.string(),
    sessionTokenHash: v.string(),
    ownerKey: v.string(),
    proposalId: v.string(),
  },
  handler: async (ctx, { siteSlug, sessionTokenHash, ownerKey, proposalId }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) throw new ConvexError("Forbidden");
    await requireEditor(ctx, site, sessionTokenHash);
    const id = ctx.db.normalizeId("wikiEditProposals", proposalId);
    if (!id) return null;
    const doc = await ctx.db.get(id);
    if (!doc || doc.siteId !== site.siteId || doc.ownerKey !== ownerKey) return null;
    return projectProposal(doc, Date.now());
  },
});

export const listForConversation = query({
  args: {
    siteSlug: v.string(),
    sessionTokenHash: v.string(),
    ownerKey: v.string(),
    conversationId: v.string(),
  },
  handler: async (ctx, { siteSlug, sessionTokenHash, ownerKey, conversationId }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return [];
    const editor = await resolveEditor(ctx, site, sessionTokenHash);
    if (!editor) return [];
    const trimmedConversationId = conversationId.trim();
    if (!trimmedConversationId) return [];
    const rows = await ctx.db
      .query("wikiEditProposals")
      .withIndex("by_site_conversation", (q) =>
        q
          .eq("siteId", site.siteId!)
          .eq("ownerKey", ownerKey)
          .eq("conversationId", trimmedConversationId),
      )
      .order("desc")
      .take(10);
    const now = Date.now();
    return rows.map((row) => ({
      proposalId: row._id,
      slug: row.slug,
      summary: row.summary,
      status: row.status === "pending" && row.expiresAt <= now ? ("expired" as const) : row.status,
      commitSha: row.commitSha,
      publishedRevision: row.publishedRevision,
    }));
  },
});

/**
 * Atomically claim a proposal for execution (approve or retry) while verifying
 * the caller's admin session and ownerKey in the same Convex transaction.
 */
export const claimForExecution = mutation({
  args: {
    siteSlug: v.string(),
    sessionTokenHash: v.string(),
    ownerKey: v.string(),
    proposalId: v.string(),
    executionId: v.string(),
  },
  handler: async (ctx, { siteSlug, sessionTokenHash, ownerKey, proposalId, executionId }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) throw new ConvexError("Forbidden");
    const user = await requireEditor(ctx, site, sessionTokenHash);
    const id = ctx.db.normalizeId("wikiEditProposals", proposalId);
    if (!id) throw new ConvexError("Not found");
    const doc = await ctx.db.get(id);
    if (!doc || doc.siteId !== site.siteId || doc.ownerKey !== ownerKey) {
      throw new ConvexError("Not found");
    }

    const now = Date.now();
    if (doc.status === "published") throw new ConvexError("Already published");
    if (doc.status === "rejected") throw new ConvexError("Already rejected");
    if (doc.status === "expired" || (doc.status === "pending" && doc.expiresAt <= now)) {
      if (doc.status !== "expired") {
        await ctx.db.patch(doc._id, { status: "expired", updatedAt: now });
      }
      throw new ConvexError("Proposal expired");
    }
    if (doc.status === "executing" && (doc.executionLeaseUntil ?? 0) > now) {
      throw new ConvexError("Already executing");
    }

    const leaseUntil = now + EXECUTION_LEASE_MS;
    await ctx.db.patch(doc._id, {
      status: "executing",
      executionId,
      executionLeaseUntil: leaseUntil,
      approvedByUserId: user._id,
      error: undefined,
      updatedAt: now,
    });
    const claimed = (await ctx.db.get(doc._id))!;
    return {
      proposal: projectProposal(claimed, now),
      approver: {
        userId: user._id,
        email: user.email,
        name: user.name ?? null,
      },
    };
  },
});

export const recordCommit = mutation({
  args: {
    siteSlug: v.string(),
    proposalId: v.id("wikiEditProposals"),
    executionId: v.string(),
    commitSha: v.string(),
    commitUrl: v.optional(v.string()),
  },
  handler: async (ctx, { siteSlug, proposalId, executionId, commitSha, commitUrl }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await ctx.db.get(proposalId);
    if (!doc || doc.siteId !== site.siteId || doc.executionId !== executionId) {
      throw new ConvexError("Execution mismatch");
    }
    await ctx.db.patch(proposalId, {
      commitSha,
      ...(commitUrl ? { commitUrl } : {}),
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const markPublished = mutation({
  args: {
    siteSlug: v.string(),
    proposalId: v.id("wikiEditProposals"),
    executionId: v.string(),
    publishedRevision: v.number(),
    commitSha: v.optional(v.string()),
    commitUrl: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { siteSlug, proposalId, executionId, publishedRevision, commitSha, commitUrl },
  ) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await ctx.db.get(proposalId);
    if (!doc || doc.siteId !== site.siteId || doc.executionId !== executionId) {
      throw new ConvexError("Execution mismatch");
    }
    await ctx.db.patch(proposalId, {
      status: "published",
      publishedRevision,
      ...(commitSha ? { commitSha } : {}),
      ...(commitUrl ? { commitUrl } : {}),
      executionId: undefined,
      executionLeaseUntil: undefined,
      error: undefined,
      updatedAt: Date.now(),
    });
    return projectProposal((await ctx.db.get(proposalId))!, Date.now());
  },
});

export const markPendingPublish = mutation({
  args: {
    siteSlug: v.string(),
    proposalId: v.id("wikiEditProposals"),
    executionId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { siteSlug, proposalId, executionId, error }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await ctx.db.get(proposalId);
    if (!doc || doc.siteId !== site.siteId || doc.executionId !== executionId) {
      throw new ConvexError("Execution mismatch");
    }
    await ctx.db.patch(proposalId, {
      status: "committed_pending_publish",
      error: error.slice(0, 1000),
      executionId: undefined,
      executionLeaseUntil: undefined,
      updatedAt: Date.now(),
    });
    return projectProposal((await ctx.db.get(proposalId))!, Date.now());
  },
});

export const markFailed = mutation({
  args: {
    siteSlug: v.string(),
    proposalId: v.id("wikiEditProposals"),
    executionId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { siteSlug, proposalId, executionId, error }) => {
    const site = await requireSite(ctx, siteSlug);
    const doc = await ctx.db.get(proposalId);
    if (!doc || doc.siteId !== site.siteId || doc.executionId !== executionId) {
      throw new ConvexError("Execution mismatch");
    }
    await ctx.db.patch(proposalId, {
      status: doc.commitSha ? "committed_pending_publish" : "failed",
      error: error.slice(0, 1000),
      executionId: undefined,
      executionLeaseUntil: undefined,
      updatedAt: Date.now(),
    });
    return projectProposal((await ctx.db.get(proposalId))!, Date.now());
  },
});

export const rejectProposal = mutation({
  args: {
    siteSlug: v.string(),
    sessionTokenHash: v.string(),
    ownerKey: v.string(),
    proposalId: v.string(),
  },
  handler: async (ctx, { siteSlug, sessionTokenHash, ownerKey, proposalId }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) throw new ConvexError("Forbidden");
    await requireEditor(ctx, site, sessionTokenHash);
    const id = ctx.db.normalizeId("wikiEditProposals", proposalId);
    if (!id) throw new ConvexError("Not found");
    const doc = await ctx.db.get(id);
    if (!doc || doc.siteId !== site.siteId || doc.ownerKey !== ownerKey) {
      throw new ConvexError("Not found");
    }
    if (doc.status !== "pending") {
      throw new ConvexError(`Cannot reject proposal in status ${doc.status}`);
    }
    await ctx.db.patch(doc._id, {
      status: "rejected",
      updatedAt: Date.now(),
    });
    return projectProposal((await ctx.db.get(doc._id))!, Date.now());
  },
});

export const listStuckExecutions = query({
  args: { siteSlug: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { siteSlug, limit = 20 }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return [];
    const now = Date.now();
    const [executing, pendingPublish] = await Promise.all([
      ctx.db
        .query("wikiEditProposals")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site.siteId!).eq("status", "executing"),
        )
        .take(limit),
      ctx.db
        .query("wikiEditProposals")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site.siteId!).eq("status", "committed_pending_publish"),
        )
        .take(limit),
    ]);
    return [
      ...executing.filter((row) => (row.executionLeaseUntil ?? 0) <= now),
      ...pendingPublish,
    ].map((row) => projectProposal(row, now));
  },
});

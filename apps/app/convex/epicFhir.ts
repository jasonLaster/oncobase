/* eslint-disable no-restricted-syntax */
import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireSite, rowBelongsToSite, type SiteCtx } from "./lib/site";
import type { Doc, Id } from "./_generated/dataModel";

type AnyCtx = QueryCtx | MutationCtx;

function requireConfiguredSite(site: SiteCtx) {
  if (!site.siteId) {
    throw new Error(`site ${site.siteSlug} is not configured`);
  }
  return site.siteId;
}

async function assertUserBelongsToSite(
  ctx: AnyCtx,
  site: SiteCtx,
  userId: Id<"users"> | undefined,
) {
  if (!userId) return;
  const user = await ctx.db.get(userId);
  if (!user || !rowBelongsToSite(user, site)) {
    throw new Error("user does not belong to this site");
  }
}

async function findConnection(
  ctx: AnyCtx,
  site: SiteCtx,
  providerKey: string,
): Promise<Doc<"epicFhirConnections"> | null> {
  if (!site.siteId) return null;
  return await ctx.db
    .query("epicFhirConnections")
    .withIndex("by_site_provider", (q) =>
      q.eq("siteId", site.siteId!).eq("providerKey", providerKey),
    )
    .first();
}

export const createOAuthState = mutation({
  args: {
    providerKey: v.string(),
    stateHash: v.string(),
    redirectUri: v.string(),
    codeVerifierCiphertext: v.string(),
    fhirBaseUrl: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    scopes: v.array(v.string()),
    expiresAt: v.number(),
    userId: v.optional(v.id("users")),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const site = await requireSite(ctx, args.siteSlug);
    const siteId = requireConfiguredSite(site);
    await assertUserBelongsToSite(ctx, site, args.userId);
    const now = Date.now();

    return await ctx.db.insert("epicFhirOAuthStates", {
      siteId,
      ...(args.userId ? { userId: args.userId } : {}),
      providerKey: args.providerKey,
      stateHash: args.stateHash,
      redirectUri: args.redirectUri,
      codeVerifierCiphertext: args.codeVerifierCiphertext,
      fhirBaseUrl: args.fhirBaseUrl,
      authorizationEndpoint: args.authorizationEndpoint,
      tokenEndpoint: args.tokenEndpoint,
      scopes: args.scopes,
      expiresAt: args.expiresAt,
      createdAt: now,
    });
  },
});

export const consumeOAuthState = mutation({
  args: {
    stateHash: v.string(),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { stateHash, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const state = await ctx.db
      .query("epicFhirOAuthStates")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", stateHash))
      .first();

    if (!state || !rowBelongsToSite(state, site)) return null;
    await ctx.db.delete(state._id);
    if (state.expiresAt <= Date.now()) return null;

    return {
      providerKey: state.providerKey,
      userId: state.userId,
      redirectUri: state.redirectUri,
      codeVerifierCiphertext: state.codeVerifierCiphertext,
      fhirBaseUrl: state.fhirBaseUrl,
      authorizationEndpoint: state.authorizationEndpoint,
      tokenEndpoint: state.tokenEndpoint,
      scopes: state.scopes,
    };
  },
});

export const upsertConnection = mutation({
  args: {
    providerKey: v.string(),
    providerName: v.string(),
    fhirBaseUrl: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    patientIdCiphertext: v.optional(v.string()),
    scopes: v.array(v.string()),
    accessTokenCiphertext: v.optional(v.string()),
    refreshTokenCiphertext: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    userId: v.optional(v.id("users")),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const site = await requireSite(ctx, args.siteSlug);
    const siteId = requireConfiguredSite(site);
    await assertUserBelongsToSite(ctx, site, args.userId);
    const now = Date.now();
    const existing = await findConnection(ctx, site, args.providerKey);
    const patch = {
      ...(args.userId ? { userId: args.userId } : {}),
      providerName: args.providerName,
      fhirBaseUrl: args.fhirBaseUrl,
      authorizationEndpoint: args.authorizationEndpoint,
      tokenEndpoint: args.tokenEndpoint,
      patientIdCiphertext: args.patientIdCiphertext,
      scopes: args.scopes,
      accessTokenCiphertext: args.accessTokenCiphertext,
      refreshTokenCiphertext: args.refreshTokenCiphertext,
      tokenExpiresAt: args.tokenExpiresAt,
      status: "active" as const,
      lastSyncError: undefined,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("epicFhirConnections", {
      siteId,
      providerKey: args.providerKey,
      createdAt: now,
      ...patch,
    });
  },
});

export const listSyncTargets = query({
  args: { siteSlug: v.optional(v.string()) },
  handler: async (ctx, { siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    if (!site.siteId) return [];

    const [activeConnections, erroredConnections] = await Promise.all([
      ctx.db
        .query("epicFhirConnections")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site.siteId!).eq("status", "active"),
        )
        .collect(),
      ctx.db
        .query("epicFhirConnections")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site.siteId!).eq("status", "error"),
        )
        .collect(),
    ]);

    return [...activeConnections, ...erroredConnections]
      .filter((connection) => rowBelongsToSite(connection, site))
      .map((connection) => ({
        _id: connection._id,
        providerKey: connection.providerKey,
        providerName: connection.providerName,
        fhirBaseUrl: connection.fhirBaseUrl,
        authorizationEndpoint: connection.authorizationEndpoint,
        tokenEndpoint: connection.tokenEndpoint,
        patientIdCiphertext: connection.patientIdCiphertext,
        scopes: connection.scopes,
        accessTokenCiphertext: connection.accessTokenCiphertext,
        refreshTokenCiphertext: connection.refreshTokenCiphertext,
        tokenExpiresAt: connection.tokenExpiresAt,
        lastObservationIssuedAt: connection.lastObservationIssuedAt,
        lastDiagnosticReportDate: connection.lastDiagnosticReportDate,
      }));
  },
});

export const markSyncStarted = mutation({
  args: {
    connectionId: v.id("epicFhirConnections"),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { connectionId, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const connection = await ctx.db.get(connectionId);
    if (!connection || !rowBelongsToSite(connection, site)) {
      throw new Error("connection not found");
    }
    await ctx.db.patch(connectionId, {
      lastSyncStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const markSyncComplete = mutation({
  args: {
    connectionId: v.id("epicFhirConnections"),
    accessTokenCiphertext: v.optional(v.string()),
    refreshTokenCiphertext: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    lastObservationIssuedAt: v.optional(v.string()),
    lastDiagnosticReportDate: v.optional(v.string()),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const site = await requireSite(ctx, args.siteSlug);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || !rowBelongsToSite(connection, site)) {
      throw new Error("connection not found");
    }
    const now = Date.now();
    await ctx.db.patch(args.connectionId, {
      accessTokenCiphertext: args.accessTokenCiphertext,
      refreshTokenCiphertext: args.refreshTokenCiphertext,
      tokenExpiresAt: args.tokenExpiresAt,
      lastObservationIssuedAt:
        args.lastObservationIssuedAt ?? connection.lastObservationIssuedAt,
      lastDiagnosticReportDate:
        args.lastDiagnosticReportDate ?? connection.lastDiagnosticReportDate,
      lastSyncAt: now,
      lastSyncError: undefined,
      status: "active",
      updatedAt: now,
    });
  },
});

export const markSyncError = mutation({
  args: {
    connectionId: v.id("epicFhirConnections"),
    error: v.string(),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, { connectionId, error, siteSlug }) => {
    const site = await requireSite(ctx, siteSlug);
    const connection = await ctx.db.get(connectionId);
    if (!connection || !rowBelongsToSite(connection, site)) {
      throw new Error("connection not found");
    }
    await ctx.db.patch(connectionId, {
      lastSyncError: error.slice(0, 1000),
      status: "error",
      updatedAt: Date.now(),
    });
  },
});

export const upsertLabResult = mutation({
  args: {
    connectionId: v.id("epicFhirConnections"),
    resourceType: v.string(),
    fhirId: v.string(),
    status: v.optional(v.string()),
    category: v.optional(v.string()),
    codeText: v.optional(v.string()),
    codeSystem: v.optional(v.string()),
    code: v.optional(v.string()),
    effectiveAt: v.optional(v.string()),
    issuedAt: v.optional(v.string()),
    sortAt: v.string(),
    valueText: v.optional(v.string()),
    unit: v.optional(v.string()),
    referenceRangeText: v.optional(v.string()),
    interpretation: v.optional(v.string()),
    rawHash: v.string(),
    rawJsonCiphertext: v.string(),
    siteSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const site = await requireSite(ctx, args.siteSlug);
    const siteId = requireConfiguredSite(site);
    const connection = await ctx.db.get(args.connectionId);
    if (!connection || !rowBelongsToSite(connection, site)) {
      throw new Error("connection not found");
    }

    const existing = await ctx.db
      .query("epicFhirLabResults")
      .withIndex("by_site_resource", (q) =>
        q
          .eq("siteId", siteId)
          .eq("resourceType", args.resourceType)
          .eq("fhirId", args.fhirId),
      )
      .first();

    const now = Date.now();
    const payload = {
      connectionId: args.connectionId,
      resourceType: args.resourceType,
      fhirId: args.fhirId,
      status: args.status,
      category: args.category,
      codeText: args.codeText,
      codeSystem: args.codeSystem,
      code: args.code,
      effectiveAt: args.effectiveAt,
      issuedAt: args.issuedAt,
      sortAt: args.sortAt,
      valueText: args.valueText,
      unit: args.unit,
      referenceRangeText: args.referenceRangeText,
      interpretation: args.interpretation,
      rawHash: args.rawHash,
      rawJsonCiphertext: args.rawJsonCiphertext,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { id: existing._id, created: false };
    }

    const id = await ctx.db.insert("epicFhirLabResults", {
      siteId,
      createdAt: now,
      ...payload,
    });
    return { id, created: true };
  },
});

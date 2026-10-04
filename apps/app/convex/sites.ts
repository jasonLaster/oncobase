import { v } from "convex/values";
import { mutation, query } from "./lib/serviceFunctions";
import { DEFAULT_SITE_SLUG, SITE_SLUG_RE, assertSiteSlug } from "./lib/site";
import { assertPublishRun, OWNED_RUN_PREFIX } from "./lib/publishRun";
import { invalidateManifest, queueManifestBuild, MANIFEST_SNAPSHOT_VERSION } from "./lib/manifestRevision";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

function normalizeHost(host: string) {
  return host.trim().toLowerCase().split(":")[0];
}

const defaultConfig = {
  enableChat: true,
  enableComments: true,
  enableDownloads: true,
  passwordGate: true,
  piiPatterns: [] as string[],
  previewSeedSlugs: ["index"],
  exclusions: [".obsidian", ".claude", "Clippings", "node_modules"],
};

const defaultQuotas = {
  monthlyOpenAITokens: 5_000_000,
  blobBytes: 1_000_000_000,
};

function publishTokenHashes(site: {
  publishTokenHash: string;
  publishTokenHashes?: string[];
  publishTokens?: Array<{ hash: string; revokedAt?: number }>;
}) {
  return Array.from(
    new Set([
      site.publishTokenHash,
      ...(site.publishTokenHashes ?? []),
      ...(site.publishTokens ?? [])
        .filter((token) => token.revokedAt === undefined)
        .map((token) => token.hash),
    ].filter(Boolean)),
  );
}

function addPublishTokenHash(
  site: {
    publishTokenHash: string;
    publishTokenHashes?: string[];
    publishTokens?: Array<{ hash: string; revokedAt?: number }>;
  },
  hash: string,
) {
  return Array.from(new Set([...publishTokenHashes(site), hash]));
}

function publishTokenRecord(name: string, hash: string, now: number) {
  return {
    id: `${now}-${hash.slice(-8)}`,
    name,
    hash,
    createdAt: now,
  };
}

function addPublishTokenRecord(
  tokens: Array<{
    id: string;
    name: string;
    hash: string;
    createdAt: number;
    revokedAt?: number;
  }> | undefined,
  name: string,
  hash: string,
  now: number,
) {
  if (tokens?.some((token) => token.hash === hash)) return tokens;
  return [...(tokens ?? []), publishTokenRecord(name, hash, now)];
}

export const getByHost = query({
  args: { host: v.string() },
  handler: async (ctx, { host }) => {
    const normalizedHost = normalizeHost(host);
    const sites = await ctx.db.query("sites").collect();
    const site = sites.find((row) => row.domains.includes(normalizedHost));
    if (!site || site.status !== "active") return null;
    return {
      slug: site.slug,
      name: site.name,
      domains: site.domains,
      config: site.config,
    };
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site || site.status !== "active") return null;
    return site;
  },
});

export const getByLiveblocksWorkspace = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_liveblocks_workspace", (q) =>
        q.eq("liveblocksWorkspaceId", workspaceId),
      )
      .first();
    if (!site || site.status !== "active") return null;
    return { slug: site.slug, name: site.name };
  },
});

// Operator-only functions below are internal: run them with `bunx convex run`
// (scripts/admin/* wrap that). The application server never calls them.
export const ensureDiana = internalMutation({
  args: {
    ownerEmail: v.optional(v.string()),
    domain: v.optional(v.string()),
    publishTokenHash: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_SITE_SLUG))
      .first();

    const domain = args.domain ?? "localhost";

    if (existing) {
      const domains = existing.domains.includes(domain)
        ? existing.domains
        : [domain, ...existing.domains];
      const tokenPatch = args.publishTokenHash
        ? {
            publishTokenHash: existing.publishTokenHash || args.publishTokenHash,
            publishTokenHashes: addPublishTokenHash(existing, args.publishTokenHash),
            publishTokens: addPublishTokenRecord(
              existing.publishTokens,
              "diana bootstrap",
              args.publishTokenHash,
              now,
            ),
          }
        : {};
      await ctx.db.patch(existing._id, {
        domains,
        ...tokenPatch,
        config: args.passwordHash
          ? { ...existing.config, passwordHash: args.passwordHash }
          : existing.config,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("sites", {
      slug: DEFAULT_SITE_SLUG,
      name: "Diana TNBC",
      ownerEmail: args.ownerEmail ?? "operator@example.com",
      status: "active",
      domains: [domain, "localhost"],
      publishTokenHash: args.publishTokenHash ?? "",
      publishTokenHashes: args.publishTokenHash ? [args.publishTokenHash] : [],
      publishTokens: args.publishTokenHash
        ? [publishTokenRecord("diana bootstrap", args.publishTokenHash, now)]
        : [],
      config: {
        ...defaultConfig,
        title: "Diana TNBC",
        description: "Diana's treatment and research wiki",
        passwordHash: args.passwordHash,
      },
      quotas: defaultQuotas,
      monthlyTokensUsed: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const create = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    ownerEmail: v.string(),
    domain: v.string(),
    publishTokenHash: v.string(),
    passwordHash: v.optional(v.string()),
    passwordGate: v.optional(v.boolean()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!SITE_SLUG_RE.test(args.slug)) {
      throw new Error("slug must match /^[a-z0-9-]{1,32}$/");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    if (existing) throw new Error("site already exists");
    return await ctx.db.insert("sites", {
      slug: args.slug,
      name: args.name,
      ownerEmail: args.ownerEmail,
      status: "active",
      domains: [normalizeHost(args.domain)],
      publishTokenHash: args.publishTokenHash,
      publishTokenHashes: [args.publishTokenHash],
      publishTokens: [publishTokenRecord("initial publisher", args.publishTokenHash, now)],
      config: {
        ...defaultConfig,
        passwordGate: args.passwordGate ?? defaultConfig.passwordGate,
        title: args.title ?? args.name,
        description: args.description,
        passwordHash: args.passwordHash,
      },
      quotas: defaultQuotas,
      monthlyTokensUsed: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const addPublishToken = internalMutation({
  args: {
    slug: v.string(),
    publishTokenHash: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { slug, publishTokenHash, name }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site || site.status !== "active") {
      throw new Error("site not active");
    }
    const hashes = addPublishTokenHash(site, publishTokenHash);
    const now = Date.now();
    await ctx.db.patch(site._id, {
      publishTokenHash: site.publishTokenHash || publishTokenHash,
      publishTokenHashes: hashes,
      publishTokens: addPublishTokenRecord(
        site.publishTokens,
        name ?? "publisher",
        publishTokenHash,
        now,
      ),
      updatedAt: now,
    });
    return { siteId: site._id, publishTokenHashes: hashes.length };
  },
});

export const beginPublish = mutation({
  args: { slug: v.string(), runId: v.optional(v.string()), scope: v.optional(v.object({ documents: v.array(v.string()), assets: v.array(v.string()) })) },
  handler: async (ctx, { slug, runId, scope }) => {
    if ((runId !== undefined) !== (scope !== undefined) || (runId && !runId.startsWith(OWNED_RUN_PREFIX))) throw new Error("Publish conflict: invalid run identity/scope");
    if (scope && (scope.documents.length > 1000 || scope.assets.length > 1024 || JSON.stringify(scope).length > 200_000)) throw new Error("Publish conflict: scope exceeds limit");
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site || site.status !== "active") throw new Error("site not active");
    const now = Date.now();
    if (site.publishLockUntil && site.publishLockUntil > now) {
      if (runId && site.publishRunId === runId && JSON.stringify(site.publishScope) === JSON.stringify(scope)) return;
      throw new Error("publish already running");
    }
    // Taking over an expired owner must expose any partial writes even when
    // this successor is an old publisher that performs no content writes.
    if (site.publishRunId && site.publishRunChanged !== false) await invalidateManifest(ctx, site._id);
    await ctx.db.patch(site._id, {
      lastPublishStatus: "running",
      lastPublishError: undefined,
      publishLockUntil: now + 10 * 60 * 1000,
      publishRunId: runId,
      publishRunChanged: runId ? false : undefined,
      publishJournalVersion: runId ? 1 : undefined,
      publishScope: scope,
      updatedAt: now,
    });
    if (runId) await ctx.scheduler.runAfter(10 * 60 * 1000, internal.sites.expirePublish, { slug, runId });
  },
});

// A crashed publisher may never abort. Finalize invalidation when its lease
// expires, but never clear a successor's lock or mark it failed.
export const expirePublish = internalMutation({
  args: { slug: v.string(), runId: v.string() },
  handler: async (ctx, { slug, runId }): Promise<null> => {
    const site = await ctx.db.query("sites").withIndex("by_slug", q => q.eq("slug", slug)).first();
    if (!site) return null;
    if (site.publishRunId !== runId || (site.publishLockUntil ?? 0) <= Date.now()) {
      await ctx.scheduler.runAfter(0, internal.sites.cleanupPublishChanges, { siteId: site._id, runId });
    }
    if (site.publishRunId !== runId || (site.publishLockUntil ?? 0) > Date.now()) return null;
    if (site.publishRunChanged !== false) await invalidateManifest(ctx, site._id);
    await ctx.db.patch(site._id, { publishRunId: undefined, publishRunChanged: undefined, publishJournalVersion: undefined, publishScope: undefined, publishLockUntil: undefined,
      lastPublishStatus: "failed", lastPublishError: "Publisher lease expired before completion", updatedAt: Date.now() });
    return null;
  },
});

export const finishPublish = mutation({
  args: { slug: v.string(), runId: v.optional(v.string()), clientTraceId: v.optional(v.string()) },
  handler: async (ctx, { slug, runId, clientTraceId }) => {
    if (clientTraceId && !/^[a-f0-9]{32}$/.test(clientTraceId)) throw new Error("Invalid trace identity");
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) throw new Error("site not found");
    const owned = assertPublishRun(site, runId);
    if (owned && site.publishRunChanged !== false) {
      // The server records actual writes transactionally. A broad selection or
      // unchanged referenced assets must not force a whole-vault rebuild.
      let slugs = site.publishScope?.documents;
      let assetsChanged = site.publishScope?.assets.length !== 0;
      if (site.publishJournalVersion === 1 && runId) {
        const entries = await ctx.db.query("publishChanges").withIndex("by_run_kind_key", q => q.eq("siteId", site._id).eq("runId", runId).eq("kind", "document")).take(129);
        slugs = entries.map(entry => entry.key);
        assetsChanged = Boolean(await ctx.db.query("publishChanges").withIndex("by_run_kind_key", q => q.eq("siteId", site._id).eq("runId", runId).eq("kind", "asset")).first());
      }
      const delta = !assetsChanged && slugs && slugs.length > 0 && slugs.length <= 128
        ? { baseRevision: site.manifestRevision ?? 0, slugs } : undefined;
      await invalidateManifest(ctx, site._id, 0, delta, clientTraceId);
    }
    // A no-op can reuse only the current-format/current-revision snapshot.
    // Missing/stale snapshots still need repair and reader verification.
    if (owned && site.publishRunChanged === false) {
      const snapshot = site.manifestSnapshot;
      const reusable = snapshot && snapshot.revision === (site.manifestRevision ?? 0) &&
        snapshot.formatVersion === MANIFEST_SNAPSHOT_VERSION && await ctx.storage.getUrl(snapshot.storageId);
      if (!reusable) await queueManifestBuild(ctx, site._id, 0, undefined, clientTraceId);
    }
    const now = Date.now();
    await ctx.db.patch(site._id, {
      lastPublishedAt: now,
      lastPublishStatus: "succeeded",
      lastPublishError: undefined,
      publishLockUntil: undefined,
      publishRunId: undefined,
      publishRunChanged: undefined,
      publishJournalVersion: undefined,
      publishScope: undefined,
      updatedAt: now,
    });
    return { revision: (site.manifestRevision ?? 0) + (owned && site.publishRunChanged !== false ? 1 : 0) };
  },
});

// Authenticated publisher readiness. Storage URLs stay in the server process.
export const publisherStatus = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db.query("sites").withIndex("by_slug", q => q.eq("slug", slug)).first();
    if (!site || site.status !== "active") throw new Error("site not active");
    const revision = site.manifestRevision ?? 0;
    const snapshot = site.manifestSnapshot;
    const diagnostic = { snapshotRevision: snapshot?.revision ?? -1, queuedAt: site.manifestBuildQueuedAt ?? 0, activeWriter: (site.publishLockUntil ?? 0) > Date.now() };
    if (!snapshot || snapshot.revision !== revision || snapshot.formatVersion !== MANIFEST_SNAPSHOT_VERSION) return { ...diagnostic, revision, snapshot: null };
    const url = await ctx.storage.getUrl(snapshot.storageId);
    return { ...diagnostic, revision, snapshot: url ? { url, hash: snapshot.hash } : null };
  },
});

export const failPublish = mutation({
  args: { slug: v.string(), error: v.string(), runId: v.optional(v.string()) },
  handler: async (ctx, { slug, error, runId }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) throw new Error("site not found");
    const owned = assertPublishRun(site, runId, { allowExpired: true });
    // Failed runs can have partially applied writes. Never leave an old snapshot
    // installed indefinitely just because the publisher did not reach finish.
    if (owned && site.publishRunChanged !== false) await invalidateManifest(ctx, site._id);
    await ctx.db.patch(site._id, {
      lastPublishStatus: "failed",
      lastPublishError: error.slice(0, 2000),
      publishLockUntil: undefined,
      publishRunId: undefined,
      publishRunChanged: undefined,
      publishJournalVersion: undefined,
      publishScope: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const archive = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) return { archived: false };
    if (site.publishRunId && site.publishRunChanged !== false) await invalidateManifest(ctx, site._id);
    await ctx.db.patch(site._id, {
      status: "archived",
      archivedAt: Date.now(),
      publishLockUntil: undefined,
      publishRunId: undefined,
      publishRunChanged: undefined,
      publishJournalVersion: undefined,
      publishScope: undefined,
      updatedAt: Date.now(),
    });
    return { archived: true };
  },
});

export const restore = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) return { restored: false };
    await ctx.db.patch(site._id, {
      status: "active",
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
    return { restored: true };
  },
});

// Bounded cleanup also handles publishers that crash or abort. The original
// expiry job owns cleanup even after finish has released the run's lock.
export const cleanupPublishChanges = internalMutation({
  args: { siteId: v.id("sites"), runId: v.string() },
  handler: async (ctx, { siteId, runId }): Promise<null> => {
    const site = await ctx.db.get(siteId);
    if (site?.publishRunId === runId) return null;
    const rows = await ctx.db.query("publishChanges").withIndex("by_run_kind_key", q => q.eq("siteId", siteId).eq("runId", runId)).take(128);
    await Promise.all(rows.map(row => ctx.db.delete(row._id)));
    if (rows.length === 128) await ctx.scheduler.runAfter(0, internal.sites.cleanupPublishChanges, { siteId, runId });
    return null;
  },
});

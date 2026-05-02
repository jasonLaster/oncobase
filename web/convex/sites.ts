import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_SITE_SLUG, SITE_SLUG_RE, assertSiteSlug } from "./lib/site";

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

export const ensureDiana = mutation({
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
      await ctx.db.patch(existing._id, {
        domains,
        publishTokenHash: args.publishTokenHash ?? existing.publishTokenHash,
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

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    ownerEmail: v.string(),
    domain: v.string(),
    publishTokenHash: v.string(),
    passwordHash: v.optional(v.string()),
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
      config: {
        ...defaultConfig,
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

export const beginPublish = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site || site.status !== "active") throw new Error("site not active");
    const now = Date.now();
    if (site.publishLockUntil && site.publishLockUntil > now) {
      throw new Error("publish already running");
    }
    await ctx.db.patch(site._id, {
      lastPublishStatus: "running",
      lastPublishError: undefined,
      publishLockUntil: now + 10 * 60 * 1000,
      updatedAt: now,
    });
  },
});

export const finishPublish = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) throw new Error("site not found");
    const now = Date.now();
    await ctx.db.patch(site._id, {
      lastPublishedAt: now,
      lastPublishStatus: "succeeded",
      lastPublishError: undefined,
      publishLockUntil: undefined,
      updatedAt: now,
    });
  },
});

export const failPublish = mutation({
  args: { slug: v.string(), error: v.string() },
  handler: async (ctx, { slug, error }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) throw new Error("site not found");
    await ctx.db.patch(site._id, {
      lastPublishStatus: "failed",
      lastPublishError: error.slice(0, 2000),
      publishLockUntil: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const archive = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    assertSiteSlug(slug);
    const site = await ctx.db
      .query("sites")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!site) return { archived: false };
    await ctx.db.patch(site._id, {
      status: "archived",
      archivedAt: Date.now(),
      publishLockUntil: undefined,
      updatedAt: Date.now(),
    });
    return { archived: true };
  },
});

export const restore = mutation({
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

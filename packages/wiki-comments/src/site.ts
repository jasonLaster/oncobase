/**
 * Site-scoped Liveblocks credential resolution.
 *
 * Multi-tenant invariant: comments must never cross sites. Liveblocks
 * isolation is achieved by per-site workspaces (separate API keys), as
 * documented in plans/multi-tenant-wiki/MVP.md "Per-site Liveblocks
 * workspaces".
 *
 * Runtime contract enforced here:
 *
 *   1. If the site has explicit `liveblocksSecretKey` / `liveblocksPublicKey`
 *      set in `sites.config`, those win — that is the per-site workspace.
 *   2. The DEFAULT site (Diana) may fall back to the deployment-level
 *      env vars (`LIVEBLOCKS_SECRET_KEY`, `NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY`)
 *      during the migration window. This preserves Diana's existing setup.
 *   3. Any other site without explicit per-site keys is treated as
 *      comments-disabled — every Liveblocks route returns 503. This is
 *      the v1 launch gate from R7 in plans/multi-tenant-wiki/risk-assessment.md
 *      made executable: a non-Diana site cannot enable comments without
 *      its own workspace credentials.
 *   4. `sites.config.enableComments === false` always wins regardless of
 *      keys — operators can disable comments without touching credentials.
 *
 * This module is framework-agnostic: the caller fetches the site row (from
 * Convex, in either app) and passes it in, so the package has no Convex or
 * `apps/web` dependency.
 */

export type LiveblocksCredentials = {
  siteSlug: string;
  secretKey: string;
  publicKey: string | null;
};

export type LiveblocksDisabledReason =
  | "comments-disabled"
  | "credentials-missing";

export type LiveblocksConfig =
  | { ok: true; creds: LiveblocksCredentials }
  | { ok: false; reason: LiveblocksDisabledReason; siteSlug: string };

/**
 * Structural subset of a `sites` row that comment credential resolution needs.
 * Each app's Convex `Doc<"sites">` satisfies this interface structurally.
 */
export type CommentsSite = {
  config?: { enableComments?: boolean } | null;
  liveblocksSecretKey?: string | null;
  liveblocksPublicKey?: string | null;
};

export type ResolveLiveblocksConfigInput = {
  /** The resolved site slug for the incoming request. */
  siteSlug: string;
  /** The site row, already fetched by the caller (null when not found). */
  site: CommentsSite | null;
  /** The default ("home") site slug that may use deployment env credentials. */
  defaultSiteSlug: string;
  /** Optional explicit env overrides; defaults to process.env. */
  envSecretKey?: string | null;
  envPublicKey?: string | null;
};

function defaultEnvSecret(): string | null {
  return (
    process.env.LIVEBLOCKS_SECRET_KEY ?? process.env.LIVEBLOCKS_API_KEY ?? null
  );
}

function defaultEnvPublic(): string | null {
  return process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? null;
}

export function resolveLiveblocksConfig({
  siteSlug,
  site,
  defaultSiteSlug,
  envSecretKey,
  envPublicKey,
}: ResolveLiveblocksConfigInput): LiveblocksConfig {
  // Operator can disable comments per site regardless of credentials.
  if (site?.config?.enableComments === false) {
    return { ok: false, reason: "comments-disabled", siteSlug };
  }

  // Per-site workspace wins.
  if (site?.liveblocksSecretKey) {
    return {
      ok: true,
      creds: {
        siteSlug,
        secretKey: site.liveblocksSecretKey,
        publicKey: site.liveblocksPublicKey ?? null,
      },
    };
  }

  // Default-site migration-window fallback to deployment env.
  if (siteSlug === defaultSiteSlug) {
    const secret = envSecretKey ?? defaultEnvSecret();
    if (!secret) {
      return { ok: false, reason: "credentials-missing", siteSlug };
    }
    return {
      ok: true,
      creds: {
        siteSlug,
        secretKey: secret,
        publicKey: envPublicKey ?? defaultEnvPublic(),
      },
    };
  }

  // Any other site without explicit per-site keys: hard-disable. Comments
  // for non-default sites require provisioning a Liveblocks workspace and
  // storing its keys on the site row.
  return { ok: false, reason: "credentials-missing", siteSlug };
}

export function liveblocksDisabledResponse(config: {
  ok: false;
  reason: LiveblocksDisabledReason;
  siteSlug: string;
}) {
  const status = config.reason === "comments-disabled" ? 403 : 503;
  return Response.json(
    {
      error:
        config.reason === "comments-disabled"
          ? `Comments are disabled for site "${config.siteSlug}".`
          : `Liveblocks credentials are not configured for site "${config.siteSlug}".`,
      reason: config.reason,
    },
    { status },
  );
}

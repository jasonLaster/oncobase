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
 */

import type { Doc } from "../../../apps/web/convex/_generated/dataModel";
import { api } from "../../../apps/web/convex/_generated/api";
import { getConvexServerClient } from "../../../apps/web/src/lib/convex-server";
import { DEFAULT_SITE_SLUG, siteSlugFromRequest } from "../../../apps/web/src/lib/site";

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

function envSecret(): string | null {
  return (
    process.env.LIVEBLOCKS_SECRET_KEY ?? process.env.LIVEBLOCKS_API_KEY ?? null
  );
}

function envPublic(): string | null {
  return process.env.NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY ?? null;
}

export async function resolveLiveblocksConfig(
  request: { headers: Headers },
): Promise<LiveblocksConfig> {
  const siteSlug = siteSlugFromRequest(request);

  let site: Doc<"sites"> | null = null;
  try {
    site = await getConvexServerClient().query(api.sites.getBySlug, {
      slug: siteSlug,
    });
  } catch {
    site = null;
  }

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

  // Diana migration-window fallback to deployment env.
  if (siteSlug === DEFAULT_SITE_SLUG) {
    const secret = envSecret();
    if (!secret) {
      return { ok: false, reason: "credentials-missing", siteSlug };
    }
    return {
      ok: true,
      creds: { siteSlug, secretKey: secret, publicKey: envPublic() },
    };
  }

  // Any other site without explicit per-site keys: hard-disable. Comments
  // for non-Diana sites require provisioning a Liveblocks workspace and
  // storing its keys on the site row (Phase 6 work).
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

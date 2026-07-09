/**
 * Site-scoped Liveblocks credential resolution.
 *
 * Hosts provide the site lookup and feature flag behavior. The comments
 * package only owns the common fallback/env contract and disabled response
 * shape, so it can run from either Next or the Vite API runtime.
 */

export type LiveblocksSiteRecord = {
  config?: { enableComments?: boolean } | null;
  liveblocksPublicKey?: string | null;
  liveblocksSecretKey?: string | null;
};

export type LiveblocksSiteResolverAdapter = {
  defaultSiteSlug: string;
  getSiteBySlug: (siteSlug: string) => Promise<LiveblocksSiteRecord | null>;
  isCommentsFeatureEnabled?: () => boolean;
  siteSlugFromRequest: (request: { headers: Headers }) => string;
};

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
  adapter: LiveblocksSiteResolverAdapter,
): Promise<LiveblocksConfig> {
  const siteSlug = adapter.siteSlugFromRequest(request);

  if (adapter.isCommentsFeatureEnabled?.() === false) {
    return { ok: false, reason: "comments-disabled", siteSlug };
  }

  let site: LiveblocksSiteRecord | null = null;
  try {
    site = await adapter.getSiteBySlug(siteSlug);
  } catch {
    site = null;
  }

  if (site?.config?.enableComments === false) {
    return { ok: false, reason: "comments-disabled", siteSlug };
  }

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

  if (siteSlug === adapter.defaultSiteSlug) {
    const secret = envSecret();
    if (!secret) {
      return { ok: false, reason: "credentials-missing", siteSlug };
    }
    return {
      ok: true,
      creds: { siteSlug, secretKey: secret, publicKey: envPublic() },
    };
  }

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

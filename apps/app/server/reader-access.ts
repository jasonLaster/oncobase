// Shared reader access and redaction helpers. Kept separate from the API router
// so a normal HTML request does not initialize unrelated API features.
import { createBackendClient } from "./backend-client";
import { traceBackendCache } from "./backend-tracing";
import { USER_SESSION_COOKIE, hashSessionToken } from "./user-auth";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import type { PageWithContent } from "@oncobase/wiki-content/server";
import { verifyWikiGateSession } from "@oncobase/wiki-content/gate-session";
import { applyPiiRedactions, parseSitePiiPatterns, type PiiPattern } from "@oncobase/wiki-content/pii";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

export const DEFAULT_SITE_SLUG = "diana";
const HOST_CACHE_TTL_MS = 15_000;
// Gate configuration (password gate, password hash, PII patterns) is shared
// across requests for this long. A password or gate change takes effect within
// this window; it is never cached when the lookup fails.
export const GATE_CACHE_TTL_MS = 10_000;
const VERCEL_PROJECT_HOST_PREFIX = "diana-tnbc";
const DIANA_TEST_AUTH_HEADER = "x-diana-test-auth";
const DEV_GATE_SESSION_SECRET = "oncobase-wiki-gate-development-only";

type ResolvedSite = {
  slug: Promise<string | null>;
  expires: number;
};

export type PasswordGateEntry = {
  enabled: boolean;
  passwordHash?: string;
};

/** The slice of a site row the gate and redaction need (`sites:gate`). */
export type SiteGate = {
  passwordGate: boolean;
  passwordHash: string | null;
  piiPatterns: string[];
} | null;

type GateEntry = { gate: Promise<SiteGate>; expires: number };

export type SessionUser = {
  _id: Id<"users">;
  email: string;
  name?: string | null;
};

// Entries hold in-flight promises, so a burst of parallel requests shares one
// lookup instead of each missing the cache before the first one resolves.
const hostCache = new Map<string, ResolvedSite>();
const gateCache = new WeakMap<ConvexHttpClient, Map<string, GateEntry>>();
const legacyGateClients = new WeakMap<ConvexHttpClient, number>();
const requestPasswordGateConfigs = new WeakMap<
  Request,
  Map<string, Promise<PasswordGateEntry>>
>();
const requestSites = new WeakMap<Request, Map<string, Promise<SiteGate>>>();
const requestSessionUsers = new WeakMap<Request, Map<string, Promise<FunctionReturnType<typeof api.users.getSessionUser>>>>();

function isMissingFunction(error: unknown) {
  return /Could not find (public )?function/i.test(error instanceof Error ? error.message : String(error));
}

async function querySiteGate(client: ConvexHttpClient, siteSlug: string): Promise<SiteGate> {
  // Until Convex has `sites:gate`, read the full row and keep only the slice.
  if ((legacyGateClients.get(client) ?? 0) <= Date.now()) {
    try {
      return await client.query(api.sites.gate, { slug: siteSlug });
    } catch (error) {
      if (!isMissingFunction(error)) throw error;
      legacyGateClients.set(client, Date.now() + 60_000);
    }
  }
  const site = await client.query(api.sites.getBySlug, { slug: siteSlug });
  return site ? {
    passwordGate: site.config.passwordGate,
    passwordHash: site.config.passwordHash ?? null,
    piiPatterns: site.config.piiPatterns ?? [],
  } : null;
}

/** Gate configuration for a site, cached for GATE_CACHE_TTL_MS per client and
 * single-flighted. A failed lookup is dropped so the next request retries. */
export function getSiteGate(client: ConvexHttpClient, siteSlug: string, now = Date.now()): Promise<SiteGate> {
  let cache = gateCache.get(client);
  if (!cache) { cache = new Map(); gateCache.set(client, cache); }
  const cached = cache.get(siteSlug);
  traceBackendCache("site-gate", Boolean(cached && cached.expires > now));
  if (cached && cached.expires > now) return cached.gate;
  const gate = querySiteGate(client, siteSlug);
  const entry = { gate, expires: now + GATE_CACHE_TTL_MS };
  cache.set(siteSlug, entry);
  void gate.catch(() => { if (cache.get(siteSlug) === entry) cache.delete(siteSlug); });
  return gate;
}

// One view of the gate per request, even if the shared entry expires mid-request.
function siteForRequest(request: Request, client: ConvexHttpClient, siteSlug: string) {
  let sites = requestSites.get(request);
  if (!sites) { sites = new Map(); requestSites.set(request, sites); }
  let pending = sites.get(siteSlug);
  if (!pending) {
    pending = getSiteGate(client, siteSlug);
    sites.set(siteSlug, pending);
  }
  return pending;
}

function normalizeHost(host: string | null) {
  return host?.trim().toLowerCase().split(":")[0] ?? null;
}

function hostFromRequest(request: Request) {
  return normalizeHost(request.headers.get("host")) ?? normalizeHost(new URL(request.url).host);
}

function explicitSiteSlug() {
  return process.env.WIKI_SITE_SLUG?.trim() || process.env.SITE_SLUG?.trim() || null;
}

function localSiteForHost(host: string) {
  const override = explicitSiteSlug();
  if (override) return override;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return DEFAULT_SITE_SLUG;
  }
  if (host.endsWith(".localhost")) {
    return host.slice(0, -".localhost".length);
  }
  return null;
}

function previewSiteForHost(host: string) {
  const override = explicitSiteSlug();
  if (override) return override;
  if (process.env.VERCEL_ENV !== "preview") return null;
  if (!host.endsWith(".vercel.app")) return null;
  if (
    host === `${VERCEL_PROJECT_HOST_PREFIX}.vercel.app` ||
    host.startsWith(`${VERCEL_PROJECT_HOST_PREFIX}-`)
  ) {
    return DEFAULT_SITE_SLUG;
  }
  return null;
}

export async function resolveSiteSlug(request: Request, client: ConvexHttpClient) {
  const host = hostFromRequest(request);
  if (!host) return null;

  const now = Date.now();
  const cached = hostCache.get(host);
  traceBackendCache("site-host", Boolean(cached && cached.expires > now));
  if (cached && cached.expires > now) {
    return cached.slug;
  }

  const localSlug = process.env.NODE_ENV !== "production" ? localSiteForHost(host) : null;
  const previewSlug = localSlug ? null : previewSiteForHost(host);
  const slug = (localSlug ?? previewSlug)
    ? Promise.resolve(localSlug ?? previewSlug)
    : client.query(api.sites.getByHost, { host }).then(site => site?.slug ?? null);
  const entry = { slug, expires: now + HOST_CACHE_TTL_MS };
  hostCache.set(host, entry);
  // A failed lookup must not answer "unknown site" for the next 15 seconds.
  void slug.catch(() => { if (hostCache.get(host) === entry) hostCache.delete(host); });
  return slug;
}

export function getRequestPasswordGateConfig(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  let configs = requestPasswordGateConfigs.get(request);
  if (!configs) {
    configs = new Map();
    requestPasswordGateConfigs.set(request, configs);
  }
  const cached = configs.get(siteSlug);
  if (cached) return cached;

  const pending = siteForRequest(request, client, siteSlug).then(site => ({
    enabled: site?.passwordGate ?? siteSlug === DEFAULT_SITE_SLUG,
    passwordHash: site?.passwordHash ?? undefined,
  }));
  configs.set(siteSlug, pending);
  void pending.catch(() => {
    if (configs?.get(siteSlug) === pending) configs.delete(siteSlug);
  });
  return pending;
}

export function isDianaPreviewTestAuth(request: Request, siteSlug: string) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return (
    process.env.VERCEL_ENV === "preview" &&
    siteSlug === DEFAULT_SITE_SLUG &&
    Boolean(secret) &&
    request.headers.get(DIANA_TEST_AUTH_HEADER) === secret
  );
}

export function authedCookieName(siteSlug: string) {
  return siteSlug === DEFAULT_SITE_SLUG ? "authed" : `authed_${siteSlug}`;
}

export function gateSessionSecret() {
  const configured = process.env.WIKI_GATE_SESSION_SECRET?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production"
    ? null
    : DEV_GATE_SESSION_SECRET;
}

export function passwordHashForSite(siteSlug: string, configured?: string | null) {
  if (configured) return configured;
  return siteSlug === DEFAULT_SITE_SLUG
    ? process.env.DIANA_WIKI_PASSWORD_HASH?.trim() || null
    : null;
}

export function gateVersionForConfig(
  siteSlug: string,
  config: Pick<PasswordGateEntry, "enabled" | "passwordHash">,
) {
  return JSON.stringify([
    config.enabled,
    passwordHashForSite(siteSlug, config.passwordHash) ?? "passwordless",
  ]);
}

export async function hasValidAuthCookie(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
  config?: PasswordGateEntry,
) {
  const cookieName = authedCookieName(siteSlug);
  const token = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  const currentConfig =
    config ?? await getRequestPasswordGateConfig(request, client, siteSlug);
  return verifyWikiGateSession({
    gateVersion: gateVersionForConfig(siteSlug, currentConfig),
    secret: gateSessionSecret(),
    siteSlug,
    token,
  });
}

export function sessionTokenFromCookie(cookieHeader: string) {
  const rawToken = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${USER_SESSION_COOKIE}=`))
    ?.slice(USER_SESSION_COOKIE.length + 1);
  return rawToken ? decodeURIComponent(rawToken) : undefined;
}

function piiPatternsFor(siteSlug: string, site: SiteGate) {
  const configured = parseSitePiiPatterns(site?.piiPatterns);
  return configured.length > 0 ? configured : siteSlug === DEFAULT_SITE_SLUG ? undefined : [];
}

export async function getPiiPatterns(client: ConvexHttpClient, siteSlug: string): Promise<PiiPattern[] | undefined> {
  // Shares the gate's cached, single-flighted read. A failed lookup throws
  // rather than turning into cached unredacted content.
  return piiPatternsFor(siteSlug, await getSiteGate(client, siteSlug));
}

export async function redactText(client: ConvexHttpClient, siteSlug: string, text: string) {
  return applyPiiRedactions(text, {
    patterns: await getPiiPatterns(client, siteSlug),
  });
}

export async function redactPageContent(
  client: ConvexHttpClient,
  siteSlug: string,
  page: PageWithContent,
  request?: Request,
): Promise<PageWithContent> {
  if (request) {
    // The gate already fetched the current site policy. Share that read, not
    // a cached authorization decision or a second serial configuration lookup.
    const patterns = piiPatternsFor(siteSlug, await siteForRequest(request, client, siteSlug));
    return { ...page, content: applyPiiRedactions(page.content, { patterns }),
      description: page.description ? applyPiiRedactions(page.description, { patterns }) : page.description };
  }
  return {
    ...page,
    content: await redactText(client, siteSlug, page.content),
    description: page.description
      ? await redactText(client, siteSlug, page.description)
      : page.description,
  };
}

export function createClient() {
  return createBackendClient();
}

export function withSiteSlug<TArgs extends object>(siteSlug: string, args: TArgs): TArgs & { siteSlug: string } {
  return { ...args, siteSlug };
}

export async function getSessionUser(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  const token = sessionTokenFromCookie(request.headers.get("cookie") ?? "");
  if (!token) return null;
  // Metadata, headers and access checks can ask about the same incoming
  // session. Share only this request's lookup; later requests verify it again.
  let users = requestSessionUsers.get(request);
  if (!users) { users = new Map(); requestSessionUsers.set(request, users); }
  let pending = users.get(siteSlug);
  if (!pending) {
    pending = client.query(api.users.getSessionUser,
      withSiteSlug(siteSlug, { tokenHash: hashSessionToken(token) }));
    users.set(siteSlug, pending);
  }
  return pending;
}

export async function canUserAccessSlug(
  client: ConvexHttpClient,
  siteSlug: string,
  user: SessionUser | null,
  slug: string,
) {
  if (!user) return false;
  return client.query(
    api.access.canUserAccessSlug,
    withSiteSlug(siteSlug, { userId: user._id, slug }),
  );
}

import {
  createWikiGateSession,
  matchesWikiPasswordHash,
  verifyWikiGateSession,
} from "@oncobase/wiki-content/gate-session";
import { DEFAULT_SITE_SLUG } from "@/lib/site";

const DEV_GATE_SESSION_SECRET = "oncobase-wiki-gate-development-only";
const GATE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function wikiGateCookieName(siteSlug: string) {
  return siteSlug === DEFAULT_SITE_SLUG ? "authed" : `authed_${siteSlug}`;
}

export function wikiGateSessionSecret() {
  const configured = process.env.WIKI_GATE_SESSION_SECRET?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production"
    ? null
    : DEV_GATE_SESSION_SECRET;
}

export function wikiPasswordHash(
  siteSlug: string,
  configuredHash?: string | null,
) {
  if (configuredHash) return configuredHash;
  if (siteSlug === DEFAULT_SITE_SLUG) {
    return process.env.DIANA_WIKI_PASSWORD_HASH?.trim() || null;
  }
  return null;
}

function wikiGateVersion(
  siteSlug: string,
  configuredHash: string | null | undefined,
  passwordGateEnabled: boolean,
) {
  return JSON.stringify([
    passwordGateEnabled,
    wikiPasswordHash(siteSlug, configuredHash) ?? "passwordless",
  ]);
}

export async function isValidWikiPassword(
  siteSlug: string,
  password: string,
  configuredHash?: string | null,
) {
  return matchesWikiPasswordHash(
    password,
    wikiPasswordHash(siteSlug, configuredHash),
  );
}

export async function createWikiGateCookieValue(
  siteSlug: string,
  configuredHash?: string | null,
  passwordGateEnabled = true,
) {
  const secret = wikiGateSessionSecret();
  if (!secret) {
    throw new Error("WIKI_GATE_SESSION_SECRET is not configured");
  }
  return createWikiGateSession({
    gateVersion: wikiGateVersion(
      siteSlug,
      configuredHash,
      passwordGateEnabled,
    ),
    secret,
    siteSlug,
    ttlSeconds: GATE_SESSION_TTL_SECONDS,
  });
}

export async function hasValidWikiGateCookie(
  siteSlug: string,
  cookieValue: string | null | undefined,
  configuredHash?: string | null,
  passwordGateEnabled = true,
) {
  return verifyWikiGateSession({
    gateVersion: wikiGateVersion(
      siteSlug,
      configuredHash,
      passwordGateEnabled,
    ),
    secret: wikiGateSessionSecret(),
    siteSlug,
    token: cookieValue,
  });
}

export const WIKI_GATE_COOKIE_MAX_AGE = GATE_SESSION_TTL_SECONDS;

import { makePublicWikiSessionIdentity } from "@oncobase/wiki-content";
import { MAX_BOOTSTRAP_BYTES, parsePageBootstrap } from "./page-payload";

/** Reading leaves the page intact for LiveStore's normal boot/seeding path.
 * Automatic scope requires a server-verified private response, never a cache. */
export function publicIdentityFromPageBootstrap(raw: string, receivedAt: number, request: {
  origin: string; pathname: string; apiOrigin: string; scope: string | null;
  configuredSiteSlug?: string; now?: number;
}) {
  if (request.scope === "session" || raw.length > MAX_BOOTSTRAP_BYTES) return null;
  const age = (request.now ?? Date.now()) - receivedAt;
  if (!Number.isFinite(age) || age < 0 || age > 60_000) return null;
  try {
    const { siteSlug, publicSessionVerified } = JSON.parse(raw);
    if (request.scope !== "public" && (request.scope !== null || publicSessionVerified !== true)) return null;
    if (typeof siteSlug !== "string" || !siteSlug.trim()) return null;
    const payload = parsePageBootstrap(raw, {
      ...request, siteSlug: request.configuredSiteSlug?.trim() || siteSlug,
    });
    return payload ? makePublicWikiSessionIdentity(payload.siteSlug) : null;
  } catch { return null; }
}

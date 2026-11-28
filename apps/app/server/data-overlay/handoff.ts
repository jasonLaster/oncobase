// The single-purpose sign-in handoff from diana-tnbc.com to data.diana-tnbc.com.
//
// The account cookie (wiki_user_session) is host-only and stays that way. A
// signed-in visitor is instead sent through diana-tnbc.com, which mints an
// HMAC-SHA256 token naming the user, the site, the data origin and a
// per-attempt `state`. The token lives at most HANDOFF_TTL_SECONDS. The data
// host accepts it only together with the matching host-only state cookie it
// set when the attempt started (OAuth-style login CSRF protection), then
// exchanges it for its own host-only session.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const HANDOFF_TTL_SECONDS = 60;
export const HANDOFF_TYPE = "data-overlay-handoff";
const HANDOFF_VERSION = 1;
/** Clock skew tolerated between the minting and verifying instances. */
const MAX_SKEW_SECONDS = 5;
export const MIN_HANDOFF_SECRET_LENGTH = 32;
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export type HandoffClaims = {
  v: typeof HANDOFF_VERSION;
  typ: typeof HANDOFF_TYPE;
  /** User id. */
  sub: string;
  site: string;
  /** The data origin, e.g. https://data.diana-tnbc.com. */
  aud: string;
  state: string;
  iat: number;
  exp: number;
};

export function createHandoffState() {
  return randomBytes(32).toString("base64url");
}

export function isHandoffState(value: string | null | undefined): value is string {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

function sign(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`${HANDOFF_TYPE}.v${HANDOFF_VERSION}.${payload}`).digest("base64url");
}

function usableSecret(secret: string | null | undefined): secret is string {
  return typeof secret === "string" && secret.length >= MIN_HANDOFF_SECRET_LENGTH;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function mintHandoffToken(
  { sub, site, aud, state }: Pick<HandoffClaims, "sub" | "site" | "aud" | "state">,
  secret: string,
  nowMs = Date.now(),
) {
  if (!usableSecret(secret)) throw new Error("DATA_OVERLAY_HANDOFF_SECRET is missing or too short");
  if (!isHandoffState(state)) throw new Error("Invalid handoff state");
  const iat = Math.floor(nowMs / 1000);
  const claims: HandoffClaims = { v: HANDOFF_VERSION, typ: HANDOFF_TYPE, sub, site, aud, state, iat, exp: iat + HANDOFF_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** The claims of a valid, unexpired token for this site, audience and
 * state; null for anything else (forged, tampered, expired, replayed into
 * another browser, minted for another host). */
export function verifyHandoffToken(
  token: string | null | undefined,
  { secret, site, aud, state, nowMs = Date.now() }: { secret: string | null | undefined; site: string; aud: string; state: string | null | undefined; nowMs?: number },
): HandoffClaims | null {
  if (!usableSecret(secret) || !token || token.length > 2048 || !isHandoffState(state)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts as [string, string];
  if (!safeEqual(signature, sign(secret, payload))) return null;
  let claims: Partial<HandoffClaims>;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); }
  catch { return null; }
  const now = Math.floor(nowMs / 1000);
  if (
    !claims || typeof claims !== "object" ||
    claims.v !== HANDOFF_VERSION || claims.typ !== HANDOFF_TYPE ||
    typeof claims.sub !== "string" || !claims.sub ||
    claims.site !== site || claims.aud !== aud ||
    typeof claims.state !== "string" || !safeEqual(claims.state, state) ||
    typeof claims.iat !== "number" || typeof claims.exp !== "number" ||
    claims.exp - claims.iat > HANDOFF_TTL_SECONDS ||
    claims.iat > now + MAX_SKEW_SECONDS ||
    claims.exp <= now
  ) {
    return null;
  }
  return claims as HandoffClaims;
}

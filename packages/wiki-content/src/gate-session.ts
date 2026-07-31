const TOKEN_VERSION = "v2";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmac(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

function payload(siteSlug: string, expiresAt: number, gateVersion: string) {
  return JSON.stringify([TOKEN_VERSION, siteSlug, expiresAt, gateVersion]);
}

export async function createWikiGateSession({
  gateVersion,
  now = Date.now(),
  secret,
  siteSlug,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}: {
  gateVersion: string;
  now?: number;
  secret: string;
  siteSlug: string;
  ttlSeconds?: number;
}) {
  if (!secret) throw new Error("Wiki gate session secret is not configured");
  if (!gateVersion) {
    throw new Error("Wiki gate session version is not configured");
  }
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  const signature = bytesToBase64Url(
    await hmac(secret, payload(siteSlug, expiresAt, gateVersion)),
  );
  return `${TOKEN_VERSION}.${expiresAt}.${signature}`;
}

export async function verifyWikiGateSession({
  gateVersion,
  now = Date.now(),
  secret,
  siteSlug,
  token,
}: {
  gateVersion: string | null | undefined;
  now?: number;
  secret: string | null | undefined;
  siteSlug: string;
  token: string | null | undefined;
}) {
  if (!gateVersion || !secret || !token) return false;
  const [version, rawExpiresAt, signature, extra] = token.split(".");
  if (
    version !== TOKEN_VERSION ||
    extra !== undefined ||
    !/^\d+$/.test(rawExpiresAt ?? "") ||
    !signature
  ) {
    return false;
  }
  const expiresAt = Number(rawExpiresAt);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) {
    return false;
  }
  const expected = bytesToBase64Url(
    await hmac(secret, payload(siteSlug, expiresAt, gateVersion)),
  );
  return constantTimeEqual(signature, expected);
}

export async function matchesWikiPasswordHash(
  password: string,
  expectedHash: string | null | undefined,
) {
  if (!expectedHash?.startsWith("sha256:")) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
  );
  const actual = `sha256:${Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  return constantTimeEqual(actual, expectedHash);
}

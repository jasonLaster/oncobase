import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const USER_SESSION_COOKIE = "wiki_user_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function createPasswordSalt() {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getSessionExpiry() {
  return Date.now() + SESSION_TTL_MS;
}

export function getSessionMaxAgeSeconds() {
  return Math.floor(SESSION_TTL_MS / 1000);
}

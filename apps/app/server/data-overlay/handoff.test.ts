import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { HANDOFF_TTL_SECONDS, createHandoffState, mintHandoffToken, verifyHandoffToken } from "./handoff";

const secret = "s".repeat(48);
const state = createHandoffState();
const now = 1_800_000_000_000;
const claims = { sub: "user1", site: "diana", aud: "https://data.diana-tnbc.com", state };
const expected = { secret, site: "diana", aud: "https://data.diana-tnbc.com", state, nowMs: now };

test("a fresh token verifies once for the same site, audience and state", () => {
  const token = mintHandoffToken(claims, secret, now);
  expect(verifyHandoffToken(token, expected)).toMatchObject({ sub: "user1", exp: now / 1000 + HANDOFF_TTL_SECONDS });
  expect(HANDOFF_TTL_SECONDS).toBeLessThanOrEqual(60);
});

test("expired, future-dated and long-lived tokens are refused", () => {
  const token = mintHandoffToken(claims, secret, now);
  expect(verifyHandoffToken(token, { ...expected, nowMs: now + HANDOFF_TTL_SECONDS * 1000 })).toBeNull();
  expect(verifyHandoffToken(token, { ...expected, nowMs: now + 59_000 })).not.toBeNull();
  expect(verifyHandoffToken(mintHandoffToken(claims, secret, now + 60_000), expected)).toBeNull();
  // A correctly signed token claiming a longer life is still refused.
  const payload = Buffer.from(JSON.stringify({ v: 1, typ: "data-overlay-handoff", ...claims, iat: now / 1000, exp: now / 1000 + 3600 })).toString("base64url");
  const signature = createHmac("sha256", secret).update(`data-overlay-handoff.v1.${payload}`).digest("base64url");
  expect(verifyHandoffToken(`${payload}.${signature}`, expected)).toBeNull();
});

test("forged, tampered and misdirected tokens are refused", () => {
  const token = mintHandoffToken(claims, secret, now);
  const [payload, signature] = token.split(".") as [string, string];
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: "admin" })).toString("base64url");
  for (const candidate of [
    `${tampered}.${signature}`,
    mintHandoffToken(claims, "x".repeat(48), now),
    `${payload}.`, `${payload}`, `.${signature}`, `${payload}.${signature}.x`, "", "not-a-token",
    `${Buffer.from("{bad json").toString("base64url")}.${createHmac("sha256", secret).update(`data-overlay-handoff.v1.${Buffer.from("{bad json").toString("base64url")}`).digest("base64url")}`,
  ]) {
    expect(verifyHandoffToken(candidate, expected)).toBeNull();
  }
  expect(verifyHandoffToken(token, { ...expected, site: "other" })).toBeNull();
  expect(verifyHandoffToken(token, { ...expected, aud: "https://evil.example" })).toBeNull();
  // Another browser (no or different state cookie) cannot use a leaked token.
  expect(verifyHandoffToken(token, { ...expected, state: createHandoffState() })).toBeNull();
  expect(verifyHandoffToken(token, { ...expected, state: undefined })).toBeNull();
  // No secret, or a short one, disables verification entirely.
  expect(verifyHandoffToken(token, { ...expected, secret: null })).toBeNull();
  expect(verifyHandoffToken(token, { ...expected, secret: "short" })).toBeNull();
  expect(() => mintHandoffToken(claims, "short", now)).toThrow();
});

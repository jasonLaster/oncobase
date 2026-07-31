import { describe, expect, test } from "bun:test";
import {
  createWikiGateSession,
  matchesWikiPasswordHash,
  verifyWikiGateSession,
} from "./gate-session";

describe("wiki gate sessions", () => {
  test("accepts only unexpired, site-bound HMAC sessions", async () => {
    const token = await createWikiGateSession({
      gateVersion: "sha256:current-password",
      now: 1_000,
      secret: "test-secret",
      siteSlug: "diana",
      ttlSeconds: 60,
    });

    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:current-password",
        now: 2_000,
        secret: "test-secret",
        siteSlug: "diana",
        token,
      }),
    ).toBe(true);
    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:current-password",
        now: 2_000,
        secret: "test-secret",
        siteSlug: "other",
        token,
      }),
    ).toBe(false);
    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:current-password",
        now: 2_000,
        secret: "wrong-secret",
        siteSlug: "diana",
        token,
      }),
    ).toBe(false);
    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:current-password",
        now: 62_000,
        secret: "test-secret",
        siteSlug: "diana",
        token,
      }),
    ).toBe(false);
    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:current-password",
        secret: "test-secret",
        siteSlug: "diana",
        token: "true",
      }),
    ).toBe(false);
  });

  test("invalidates sessions when the password configuration rotates", async () => {
    const token = await createWikiGateSession({
      gateVersion: "sha256:old-password",
      now: 1_000,
      secret: "test-secret",
      siteSlug: "diana",
      ttlSeconds: 60,
    });

    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:old-password",
        now: 2_000,
        secret: "test-secret",
        siteSlug: "diana",
        token,
      }),
    ).toBe(true);
    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:new-password",
        now: 2_000,
        secret: "test-secret",
        siteSlug: "diana",
        token,
      }),
    ).toBe(false);
  });

  test("rejects legacy sessions that were not bound to password configuration", async () => {
    expect(
      await verifyWikiGateSession({
        gateVersion: "sha256:current-password",
        now: 2_000,
        secret: "test-secret",
        siteSlug: "diana",
        token: "v1.61.legacy-signature",
      }),
    ).toBe(false);
  });

  test("checks sha256 password hashes without plaintext fallbacks", async () => {
    expect(
      await matchesWikiPasswordHash(
        "diana",
        "sha256:1b2fc9341a16ae4e30082965d537ae47c21a0f27fd43eab78330ed81751ae6db",
      ),
    ).toBe(true);
    expect(await matchesWikiPasswordHash("wrong", "sha256:00")).toBe(false);
    expect(await matchesWikiPasswordHash("diana", "diana")).toBe(false);
  });
});

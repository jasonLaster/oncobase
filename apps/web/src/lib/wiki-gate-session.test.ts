import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createWikiGateCookieValue,
  hasValidWikiGateCookie,
} from "./wiki-gate-session";

const ORIGINAL_GATE_SECRET = process.env.WIKI_GATE_SESSION_SECRET;
const ORIGINAL_DIANA_HASH = process.env.DIANA_WIKI_PASSWORD_HASH;

describe("wiki gate cookie versioning", () => {
  beforeEach(() => {
    process.env.WIKI_GATE_SESSION_SECRET = "next-gate-test-secret";
    process.env.DIANA_WIKI_PASSWORD_HASH = "sha256:environment-password";
  });

  afterEach(() => {
    process.env.WIKI_GATE_SESSION_SECRET = ORIGINAL_GATE_SECRET;
    process.env.DIANA_WIKI_PASSWORD_HASH = ORIGINAL_DIANA_HASH;
  });

  test("accepts the configured password version and rejects it after rotation", async () => {
    const token = await createWikiGateCookieValue(
      "research",
      "sha256:old-password",
    );

    expect(
      await hasValidWikiGateCookie(
        "research",
        token,
        "sha256:old-password",
      ),
    ).toBe(true);
    expect(
      await hasValidWikiGateCookie(
        "research",
        token,
        "sha256:new-password",
      ),
    ).toBe(false);
  });

  test("binds Diana fallback sessions to the environment password hash", async () => {
    const token = await createWikiGateCookieValue("diana");

    expect(await hasValidWikiGateCookie("diana", token)).toBe(true);
    process.env.DIANA_WIKI_PASSWORD_HASH = "sha256:rotated-environment-password";
    expect(await hasValidWikiGateCookie("diana", token)).toBe(false);
  });

  test("invalidates sessions when the password gate configuration toggles", async () => {
    const token = await createWikiGateCookieValue(
      "research",
      "sha256:password",
      false,
    );

    expect(
      await hasValidWikiGateCookie(
        "research",
        token,
        "sha256:password",
        false,
      ),
    ).toBe(true);
    expect(
      await hasValidWikiGateCookie(
        "research",
        token,
        "sha256:password",
        true,
      ),
    ).toBe(false);
  });
});

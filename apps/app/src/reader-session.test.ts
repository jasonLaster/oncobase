import { describe, expect, test } from "bun:test";
import { makePublicWikiSessionIdentity, type WikiScope } from "@oncobase/wiki-content";
import { explicitReaderScope, resolveReaderSession } from "./reader-session";

const publicIdentity = makePublicWikiSessionIdentity("example");
const sessionIdentity = { ...publicIdentity, scope: "session" as const, authenticated: true, cacheKey: "example:session:user-access-hash", userHash: "user-access-hash" };

describe("reader session selection", () => {
  test("ordinary links use a server-verified session identity", async () => {
    const scopes: WikiScope[] = [];
    expect(await resolveReaderSession(explicitReaderScope(""), async scope => {
      scopes.push(scope);
      return sessionIdentity;
    })).toBe(sessionIdentity);
    expect(scopes).toEqual(["session"]);
  });

  test("older servers retain the 401 fallback to a distinct public identity", async () => {
    const scopes: WikiScope[] = [];
    expect(await resolveReaderSession(null, async scope => {
      scopes.push(scope);
      if (scope === "session") throw new Error("Wiki request failed: 401 Unauthorized");
      return publicIdentity;
    })).toBe(publicIdentity);
    expect(scopes).toEqual(["session", "public"]);
  });

  test("automatic public selection completes in a single request", async () => {
    const requests: unknown[] = [];
    expect(await resolveReaderSession(null, async (scope, fallbackToPublic) => {
      requests.push({ scope, fallbackToPublic });
      return publicIdentity;
    })).toBe(publicIdentity);
    expect(requests).toEqual([{ scope: "session", fallbackToPublic: true }]);
  });

  test("explicit public links never request restricted content", async () => {
    const scopes: WikiScope[] = [];
    await resolveReaderSession(explicitReaderScope("?scope=public"), async scope => {
      scopes.push(scope);
      return publicIdentity;
    });
    expect(scopes).toEqual(["public"]);
  });

  test("explicit session links retain sign-in recovery", async () => {
    await expect(resolveReaderSession("session", async () => {
      throw new Error("Wiki request failed: 401 Unauthorized");
    })).rejects.toThrow("401");
  });

  for (const message of ["Wiki request failed: 403 Forbidden", "Wiki request failed: 503 Unavailable", "Failed to fetch"]) {
    test(`does not silently downgrade on ${message}`, async () => {
      const scopes: WikiScope[] = [];
      await expect(resolveReaderSession(null, async scope => {
        scopes.push(scope);
        throw new Error(message);
      })).rejects.toThrow(message);
      expect(scopes).toEqual(["session"]);
    });
  }
});

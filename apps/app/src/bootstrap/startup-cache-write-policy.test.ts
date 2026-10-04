import { describe, expect, test } from "bun:test";
import { shouldWriteStartupCache, startupCacheWriteKey, STARTUP_CACHE_REFRESH_MS, type StartupCacheWriteInputs } from "./startup-cache-write-policy";

const inputs: StartupCacheWriteInputs = {
  cacheKey: "diana:public", epoch: "e1", manifestHash: "m1", pathname: "/a",
  page: { contentHash: "h1", contentStatus: "fresh", hasContent: true, unavailable: false },
};

describe("startup cache write policy", () => {
  test("a manifest re-validation with no content change does not rewrite", () => {
    const key = startupCacheWriteKey(inputs);
    expect(shouldWriteStartupCache(null, key, 1_000)).toBe(true);
    expect(shouldWriteStartupCache({ key, validatedAt: 1_000 }, startupCacheWriteKey({ ...inputs }), 61_000)).toBe(false);
  });

  test("rewrites when the manifest, current page body, route or identity changes", () => {
    const last = { key: startupCacheWriteKey(inputs), validatedAt: 1_000 };
    for (const changed of [
      { ...inputs, manifestHash: "m2" },
      { ...inputs, page: { ...inputs.page!, contentHash: "h2" } },
      { ...inputs, page: { ...inputs.page!, contentStatus: "stale" } },
      { ...inputs, pathname: "/b" },
      { ...inputs, cacheKey: "diana:session:user" },
      { ...inputs, epoch: "e2" },
    ]) {
      expect(shouldWriteStartupCache(last, startupCacheWriteKey(changed), 2_000)).toBe(true);
    }
  });

  test("periodically refreshes an unchanged snapshot so it does not age out", () => {
    const key = startupCacheWriteKey(inputs);
    expect(shouldWriteStartupCache({ key, validatedAt: 0 }, key, STARTUP_CACHE_REFRESH_MS)).toBe(true);
  });
});

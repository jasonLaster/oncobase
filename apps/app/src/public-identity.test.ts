import { describe, expect, test } from "bun:test";
import { makePublicWikiSessionIdentity } from "@oncobase/wiki-content";
import {
  persistPublicIdentity,
  publicIdentityStorageKey,
  readPersistedPublicIdentity,
  resolvePublicIdentityFallback,
} from "./public-identity";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

describe("public identity fallback", () => {
  test("persists the exact versioned identity used by the public store", () => {
    const storage = memoryStorage();
    const identity = makePublicWikiSessionIdentity("diana");

    persistPublicIdentity(storage, "https://wiki.example", identity);

    expect(readPersistedPublicIdentity(storage, "https://wiki.example")).toEqual(identity);
    expect([...storage.values.keys()]).toEqual([
      publicIdentityStorageKey("https://wiki.example"),
    ]);
  });

  test("prefers a persisted host partition over the configured cold-start identity", () => {
    const storage = memoryStorage();
    const identity = makePublicWikiSessionIdentity("research");
    persistPublicIdentity(storage, "https://wiki.example", identity);

    expect(
      resolvePublicIdentityFallback({
        storage,
        partition: "https://wiki.example",
        configuredSiteSlug: "diana",
      }),
    ).toEqual(identity);
  });

  test("rejects session, malformed, and obsolete identities", () => {
    const storage = memoryStorage();
    const key = publicIdentityStorageKey("https://wiki.example");

    storage.setItem(
      key,
      JSON.stringify({
        ...makePublicWikiSessionIdentity("diana"),
        scope: "session",
        authenticated: true,
        userHash: "user",
      }),
    );
    expect(readPersistedPublicIdentity(storage, "https://wiki.example")).toBeNull();

    storage.setItem(
      key,
      JSON.stringify({
        ...makePublicWikiSessionIdentity("diana"),
        cacheVersion: "obsolete",
      }),
    );
    expect(readPersistedPublicIdentity(storage, "https://wiki.example")).toBeNull();

    storage.setItem(key, "{");
    expect(readPersistedPublicIdentity(storage, "https://wiki.example")).toBeNull();
  });

  test("does not reject a valid identity when browser storage is unavailable", () => {
    expect(() =>
      persistPublicIdentity(
        {
          setItem() {
            throw new Error("storage unavailable");
          },
        },
        "https://wiki.example",
        makePublicWikiSessionIdentity("diana"),
      ),
    ).not.toThrow();
  });
});

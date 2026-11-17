import { describe, expect, test } from "bun:test";
import type { WikiManifest, WikiManifestValidation } from "@oncobase/wiki-content";
import { assets$, fileTree$, pageIndex$, siteState$ } from "../livestore/queries";
import type { MetricsPatch, PageContentRow, PageIndexRow, SiteStateRow } from "../types";
import { MANIFEST_FRESH_MS, nextManifestCheckDelay } from "./manifest-poll-policy";
import { createSyncController, type SyncEnvironment, type SyncStore } from "./sync-controller";

const NOW = 1_000_000;

function manifest(hash: string, slugs: string[] = ["index", "a", "b"]): WikiManifest {
  return {
    schemaVersion: 1, siteSlug: "site", scope: "public", manifestHash: hash, generatedAt: "fixture", compactTree: [],
    pages: slugs.map(slug => ({ slug, title: slug, tags: [], description: null, contentHash: `${slug}-${hash}`, sensitive: false, size: 10 })),
    assets: [],
  } as WikiManifest;
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** A store, client and clock the test controls. */
function harness(options: { cached?: { hash: string; validatedAt: number; slugs?: string[] }; bodies?: Record<string, string>; bootstrapped?: string[] } = {}) {
  let now = NOW;
  const timers = new Map<number, { at: number; run: () => void }>();
  let nextTimer = 1;
  const commits: string[] = [];
  const metrics: MetricsPatch[] = [];
  let visibility: DocumentVisibilityState = "visible";
  let online = true;
  const cached = options.cached;
  const state: SiteStateRow | null = cached
    ? { id: "current", siteSlug: "site", scope: "public", manifestHash: cached.hash, generatedAt: "fixture", lastValidatedAt: cached.validatedAt, manifestSize: 100 } as unknown as SiteStateRow
    : null;
  const indexRows: PageIndexRow[] = (cached?.slugs ?? ["index", "a", "b"]).map(slug => ({
    slug, title: slug, tagsJson: "[]", description: null, contentHash: `${slug}-${cached?.hash}`, sensitive: false, size: 10,
  }) as unknown as PageIndexRow);
  const bodies = new Map(Object.entries(options.bodies ?? {}));
  const store = {
    query: (query: { label?: string }) => {
      if (query === siteState$) return state;
      if (query === fileTree$) return cached ? { treeJson: "[]" } : null;
      if (query === pageIndex$) return cached ? indexRows : [];
      if (query === assets$) return [];
      const label = query.label ?? "";
      if (label.startsWith("pageIndex:")) return cached ? indexRows.find(row => row.slug === label.slice(10)) ?? null : null;
      if (label.startsWith("pageContent:")) {
        const hash = bodies.get(label.slice(12));
        return hash ? { slug: label.slice(12), content: "body", contentHash: hash, contentStatus: "fresh" } as unknown as PageContentRow : null;
      }
      throw new Error(`unexpected query ${label}`);
    },
    commit: (...events: Array<{ name: string }>) => { for (const event of events) commits.push(event.name); },
  } as unknown as SyncStore;

  const validations: Array<{ hash: string | undefined; signal: AbortSignal; reply: Deferred<WikiManifestValidation> }> = [];
  const fetches: Array<{ slugs: string[]; versions?: Array<string | undefined>; signal?: AbortSignal; reply: Deferred<{ pages: unknown[]; unavailable?: unknown[] }> }> = [];
  const client = {
    validateManifest: (hash: string | undefined, _progress: unknown, signal: AbortSignal) => {
      const reply = deferred<WikiManifestValidation>();
      validations.push({ hash, signal, reply });
      return reply.promise;
    },
    fetchPages: (args: { slugs: string[]; versions?: Array<string | undefined>; signal?: AbortSignal }) => {
      const reply = deferred<{ pages: unknown[]; unavailable?: unknown[] }>();
      fetches.push({ ...args, reply });
      return reply.promise;
    },
  } as unknown as SyncEnvironment["client"];
  let snapshotsCleared = 0;
  const env: SyncEnvironment = {
    store, client, scope: "public",
    onMetrics: patch => { metrics.push(patch); },
    hasBootstrappedPage: slug => options.bootstrapped?.includes(slug) ?? false,
    seededFromStartupCache: false,
    online: () => online,
    visibility: () => visibility,
    foregroundFetch: () => {},
    setPageTransfer: () => {},
    setManifestReceivedBytes: () => {},
    storageSnapshot: async () => ({ usage: 1, quota: 10, pressure: "ok" as never }),
    clearStartupSnapshot: () => { snapshotsCleared++; },
    setTimeout: (run, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, run }); return id; },
    clearTimeout: id => { timers.delete(id); },
    now: () => now,
    elapsed: () => now,
  };
  /** Let promises settle and run every timer that is already due. */
  const settle = async () => {
    for (let round = 0; round < 50; round++) {
      await new Promise(resolve => setImmediate(resolve));
      const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
      if (!due.length) continue;
      for (const [id, timer] of due) { timers.delete(id); timer.run(); }
    }
  };
  const advance = async (ms: number) => { now += ms; await settle(); };
  const pendingTimers = () => [...timers.values()].map(timer => timer.at - now).sort((a, b) => a - b);
  return {
    env, commits, metrics, validations, fetches, settle, advance, pendingTimers,
    setVisibility: (value: DocumentVisibilityState) => { visibility = value; },
    setOnline: (value: boolean) => { online = value; },
    get snapshotsCleared() { return snapshotsCleared; },
  };
}

describe("SyncController", () => {
  test("a cold reader asks for its page and the manifest at once, then imports the manifest", async () => {
    const h = harness();
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    expect(h.validations.map(v => v.hash)).toEqual([undefined]);
    // The page does not wait for the manifest: the body endpoint authorizes itself.
    expect(h.fetches.map(f => f.slugs)).toEqual([["a"]]);
    expect(h.metrics).toContainEqual(expect.objectContaining({ status: "syncing", message: "Loading manifest" }));
    h.validations[0]!.reply.resolve({ status: "modified", manifest: manifest("m1"), partial: false } as WikiManifestValidation);
    await h.settle();
    expect(h.commits).toContain("v1.ManifestApplied");
    expect(h.metrics.at(-1)).toEqual(expect.objectContaining({ status: "ready", message: "Manifest m1 loaded" }));
    // The next check waits one freshness window.
    expect(h.pendingTimers()).toEqual([MANIFEST_FRESH_MS.public]);
    c.dispose();
  });

  test("a fresh cached manifest is used without a request, and checked when it ages out", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 10_000 }, bodies: { a: "a-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    expect(h.validations).toHaveLength(0);
    // The stored body has the listed hash: nothing to fetch.
    expect(h.fetches).toHaveLength(0);
    expect(h.metrics).toContainEqual(expect.objectContaining({ status: "ready", message: "Using fresh manifest m1" }));
    expect(h.pendingTimers()).toEqual([MANIFEST_FRESH_MS.public - 10_000]);
    await h.advance(MANIFEST_FRESH_MS.public - 10_000);
    expect(h.validations.map(v => v.hash)).toEqual(["m1"]);
    c.dispose();
  });

  test("requests in one task become one check", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 120_000 }, bodies: { a: "a-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    h.validations[0]!.reply.resolve({ status: "unchanged", partial: false } as WikiManifestValidation);
    await h.settle();
    c.online();
    c.visibilityChanged();
    c.requestManifestCheck("timer");
    await h.settle();
    expect(h.validations).toHaveLength(2);
    c.dispose();
  });

  test("a superseding check reuses the request already on the wire for the same hash", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 120_000 }, bodies: { a: "a-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    c.requestManifestCheck("attention");
    await h.settle();
    expect(h.validations).toHaveLength(1);
    h.validations[0]!.reply.resolve({ status: "unchanged", partial: false } as WikiManifestValidation);
    await h.settle();
    // Only the newest check commits and schedules; the superseded one is silent.
    expect(h.commits.filter(name => name === "v1.ManifestValidated")).toHaveLength(1);
    expect(h.pendingTimers()).toHaveLength(1);
    c.dispose();
  });

  test("unchanged timer checks back off; attention restores the base cadence", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 120_000 }, bodies: { a: "a-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    h.validations[0]!.reply.resolve({ status: "unchanged", partial: false } as WikiManifestValidation);
    await h.settle();
    expect(h.pendingTimers()).toEqual([nextManifestCheckDelay("public", 0)]);
    for (let i = 1; i <= 2; i++) {
      await h.advance(h.pendingTimers()[0]!);
      h.validations.at(-1)!.reply.resolve({ status: "unchanged", partial: false } as WikiManifestValidation);
      await h.settle();
      expect(h.pendingTimers()).toEqual([nextManifestCheckDelay("public", i)]);
    }
    c.visibilityChanged();
    await h.settle();
    h.validations.at(-1)!.reply.resolve({ status: "unchanged", partial: false } as WikiManifestValidation);
    await h.settle();
    expect(h.pendingTimers()).toEqual([nextManifestCheckDelay("public", 0)]);
    c.dispose();
  });

  test("a hidden tab's timer does not check", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 10_000 }, bodies: { a: "a-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    h.setVisibility("hidden");
    await h.advance(MANIFEST_FRESH_MS.public);
    expect(h.validations).toHaveLength(0);
    h.setVisibility("visible");
    c.visibilityChanged();
    await h.settle();
    expect(h.validations).toHaveLength(1);
    c.dispose();
  });

  test("a departing document does not import, and resumes itself if it stays", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 120_000 }, bodies: { a: "a-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    c.departing();
    h.validations[0]!.reply.resolve({ status: "modified", manifest: manifest("m2"), partial: false } as WikiManifestValidation);
    await h.settle();
    expect(h.commits).not.toContain("v1.ManifestApplied");
    // The navigation was canceled: after a second the reader checks again.
    await h.advance(1000);
    expect(h.validations).toHaveLength(2);
    c.dispose();
  });

  test("an auth failure clears the session caches", async () => {
    const h = harness();
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    h.validations[0]!.reply.reject(new Error("Manifest request failed: 401"));
    await h.settle();
    expect(h.commits).toContain("v1.CacheResetRequested");
    expect(h.snapshotsCleared).toBe(1);
    expect(h.metrics.at(-1)).toEqual(expect.objectContaining({ status: "error", errorReason: "auth" }));
    c.dispose();
  });

  test("a failed first manifest keeps one bounded retry timer", async () => {
    const h = harness();
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    h.validations[0]!.reply.reject(new Error("boom"));
    await h.settle();
    expect(h.metrics.at(-1)).toEqual(expect.objectContaining({ status: "error", message: "boom" }));
    expect(h.pendingTimers()).toEqual([5_000]);
    await h.advance(5_000);
    expect(h.validations).toHaveLength(2);
    c.dispose();
  });

  test("navigating aborts other pages' requests and loads the new page", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 10_000 } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    expect(h.fetches.map(f => f.slugs[0])).toEqual(["a"]);
    c.setRoute("b");
    await h.settle();
    expect(h.fetches[0]!.signal!.aborted).toBe(true);
    expect(h.fetches.map(f => f.slugs[0])).toEqual(["a", "b"]);
    // Listed pages are requested by their manifest hash (P11).
    expect(h.fetches[1]!.versions).toEqual(["b-m1"]);
    c.dispose();
  });

  test("navigating checks the manifest only once it is older than its freshness window", async () => {
    // The store's lastValidatedAt stays at its fixture value, so it ages with the clock.
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 10_000 }, bodies: { a: "a-m1", b: "b-m1", index: "index-m1" } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    c.setRoute("b");
    await h.settle();
    expect(h.validations).toHaveLength(0);
    h.setVisibility("hidden"); // keep the freshness timer out of the way
    await h.advance(MANIFEST_FRESH_MS.public);
    expect(h.validations).toHaveLength(0);
    c.setRoute("index");
    await h.settle();
    expect(h.validations).toHaveLength(1);
    c.dispose();
  });

  test("retry without a listed page refreshes the manifest and force-fetches the body", async () => {
    const h = harness();
    const c = createSyncController(h.env, "missing");
    c.start();
    await h.settle();
    c.retryPage();
    await h.settle();
    expect(h.metrics).toContainEqual(expect.objectContaining({ message: "Refreshing manifest before retry" }));
    const forced = h.fetches.at(-1)!;
    expect(forced.slugs).toEqual(["missing"]);
    // Forced reads bypass the versioned URL (and so the HTTP cache).
    expect(forced.versions).toBeUndefined();
    c.dispose();
  });

  test("a page the HTTP response already rendered is not fetched again", async () => {
    const h = harness({ bootstrapped: ["a"] });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    expect(h.fetches).toHaveLength(0);
    // It may be newer than a cached manifest, so the manifest is checked.
    expect(h.validations).toHaveLength(1);
    c.dispose();
  });

  test("dispose aborts every request and leaves no timer", async () => {
    const h = harness({ cached: { hash: "m1", validatedAt: NOW - 120_000 } });
    const c = createSyncController(h.env, "a");
    c.start();
    await h.settle();
    c.departing();
    c.dispose();
    expect(h.validations[0]!.signal.aborted).toBe(true);
    expect(h.fetches[0]!.signal!.aborted).toBe(true);
    expect(h.pendingTimers()).toEqual([]);
    c.requestManifestCheck("user");
    await h.settle();
    expect(h.validations).toHaveLength(1);
  });
});

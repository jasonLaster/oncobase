import { afterEach, expect, test } from "bun:test";
import { resetStoreRuntimeDownloads, storeRuntimeDownloads } from "./runtime-downloads";

const saved = { window: globalThis.window, location: globalThis.location, fetch: globalThis.fetch };
afterEach(() => { Object.assign(globalThis, saved); resetStoreRuntimeDownloads(); });

function install(early?: object) {
  const fetched: string[] = [];
  Object.assign(globalThis, {
    window: { __WIKI_EARLY__: early }, location: new URL("https://diana.test/wiki/page"),
    fetch: (url: string) => { fetched.push(url); return Promise.resolve(new Response("x")); },
  });
  return fetched;
}

test("the store's deadlines wait for the head script's runtime downloads, started if the paint set has not yet", async () => {
  let release!: () => void;
  const wasm = new Promise<void>(resolve => { release = resolve; });
  let started = 0;
  const fetched = install({ runtime: [wasm], runtimeUrls: ["/assets/wa-sqlite-x.wasm", "/assets/livestore.worker-x.js"], startRuntime: () => { started++; } });
  let done = false;
  const ready = storeRuntimeDownloads(["/assets/livestore.worker-x.js", "/assets/make-shared-worker-x.js"], 5_000).then(() => { done = true; });
  expect(started).toBe(1);
  // Only the worker the head script did not cover is fetched here.
  expect(fetched).toEqual(["/assets/make-shared-worker-x.js"]);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(done).toBe(false);
  release();
  await ready;
  expect(done).toBe(true);
});

test("a download that never finishes is bounded, and a failure does not hold the boot", async () => {
  install({ runtime: [new Promise(() => {}), Promise.reject(new Error("offline"))], runtimeUrls: [], startRuntime: () => {} });
  const started = performance.now();
  await storeRuntimeDownloads([], 20);
  expect(performance.now() - started).toBeLessThan(1_000);
});

test("without the head script, the store fetches its own workers", async () => {
  const fetched = install(undefined);
  await storeRuntimeDownloads(["/assets/livestore.worker-x.js"], 1_000);
  expect(fetched).toEqual(["/assets/livestore.worker-x.js"]);
});

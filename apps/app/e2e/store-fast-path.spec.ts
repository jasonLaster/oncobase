import { expect, type Page } from "@playwright/test";
import { gotoWiki, installWikiApiMocks } from "./fixtures";
import { test } from "./persistent-reader-fixture";

// The reader boots LiveStore from its own OPFS state image only when the guard
// in src/livestore/fast-path-snapshot.ts proves it is a committed SQLite state;
// otherwise the leader recreates the snapshot. The path is reported on the
// store-adapter telemetry span. These tests drive the real adapter, worker and
// OPFS files and model the two races deterministically: bytes changing between
// reads, and a journal left by a leader killed mid-transaction.
type Span = { name: string; path?: string };
const ROUTE = "/wiki/logistics/insurance";

function captureTelemetry(page: Page) {
  const spans: Span[] = [];
  void page.route("**/api/wiki/telemetry", async route => {
    try { spans.push(...(JSON.parse(route.request().postData() ?? "{}").spans ?? [])); } catch { /* Not a reader batch. */ }
    await route.fulfill({ status: 204 });
  });
  return {
    clear: () => { spans.length = 0; },
    storePath: async () => {
      await expect.poll(() => spans.find(span => span.name === "store-adapter")?.path, { timeout: 15_000 }).toBeTruthy();
      return spans.find(span => span.name === "store-adapter")!.path;
    },
    paths: () => spans.filter(span => span.name === "store-adapter").map(span => span.path),
    fastPathSpan: () => spans.find(span => span.name === "store-fast-path"),
  };
}

async function ready(page: Page) {
  await expect(page.locator('#root [data-test-id="document-article"]')).toContainText("Prior authorization", { timeout: 25_000 });
  await expect(page.locator('[data-reader-store-ready]')).toHaveAttribute("data-reader-store-ready", "true", { timeout: 25_000 });
  await expect(page.locator("html")).not.toHaveAttribute("data-wiki-first-frame", "true");
}

// The leader's state database in the AccessHandlePoolVFS directory: pool files
// whose 4096-byte header names the SQLite file. Read-only from the page.
async function stateDb(page: Page) {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    for await (const [name, dir] of root as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (dir.kind !== "directory" || !name.startsWith("livestore-")) continue;
      for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemFileHandle]>) {
        if (handle.kind !== "file") continue;
        const file = await handle.getFile();
        const header = new Uint8Array(await file.slice(0, 512).arrayBuffer());
        const path = new TextDecoder().decode(header.subarray(0, Math.max(0, header.indexOf(0))));
        if (/^\/state.*\.db$/.test(path) && file.size > 4096) return { directory: name, path, size: file.size - 4096 };
      }
    }
    return null;
  });
}

async function persistedReader(page: Page) {
  await installWikiApiMocks(page);
  const telemetry = captureTelemetry(page);
  await gotoWiki(page, ROUTE);
  await ready(page);
  // A fresh profile has no local state; wait for this boot's report so it
  // cannot be flushed (on unload) into the next boot's assertions.
  expect(await telemetry.storePath()).toBe("leader");
  await expect.poll(() => stateDb(page), { timeout: 15_000 }).toBeTruthy();
  return telemetry;
}

test("a committed local snapshot boots through the guarded fast path", async ({ page }) => {
  test.setTimeout(60_000);
  const telemetry = await persistedReader(page);
  telemetry.clear();
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  expect(await telemetry.storePath()).toBe("fast");
  expect(telemetry.fastPathSpan()?.path).toBe("fast");
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

test("bytes changing between the guard's reads fall back to the leader snapshot", async ({ page }) => {
  test.setTimeout(60_000);
  const telemetry = await persistedReader(page);
  // Model a leader rewriting pages while the first full image is read: the
  // first large OPFS read returns bytes that differ from the stored file.
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    let torn = false;
    Blob.prototype.arrayBuffer = async function () {
      const buffer = await read.call(this);
      if (!torn && this.size >= 8192 && new TextDecoder().decode(new Uint8Array(buffer, 0, 15)) === "SQLite format 3") {
        torn = true;
        new Uint8Array(buffer)[buffer.byteLength - 1] ^= 0xff;
      }
      return buffer;
    };
  });
  telemetry.clear();
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  expect(await telemetry.storePath()).toBe("fallback-changed");
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

test("a journal left by a killed leader is rejected, rolled back and then trusted again", async ({ page, context, baseURL }) => {
  test.setTimeout(90_000);
  await persistedReader(page);
  const db = (await stateDb(page))!;
  await page.close();
  // A same-origin page without the reader writes a hot rollback journal into a
  // free pool file once the closed tab's worker has released its handles.
  const fixture = await context.newPage();
  await fixture.route("**/__opfs-fixture", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>OPFS fixture</title>" }));
  await fixture.goto(`${baseURL}/__opfs-fixture`);
  await fixture.evaluate(async ({ directory, path }) => {
    // Mirrors AccessHandlePoolVFS#computeDigest and #setAssociatedPath.
    const digest = (corpus: Uint8Array) => {
      let h1 = 0xde_ad_be_ef, h2 = 0x41_c6_ce_57;
      for (const value of corpus) { h1 = Math.imul(h1 ^ value, 2_654_435_761); h2 = Math.imul(h2 ^ value, 1_597_334_677); }
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2_246_822_507) ^ Math.imul(h2 ^ (h2 >>> 13), 3_266_489_909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2_246_822_507) ^ Math.imul(h1 ^ (h1 >>> 13), 3_266_489_909);
      return new Uint32Array([h1 >>> 0, h2 >>> 0]);
    };
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(directory);
    for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemFileHandle]>) {
      if (handle.kind !== "file" || (await handle.getFile()).size !== 4096) continue;
      if (new Uint8Array(await (await handle.getFile()).slice(0, 1).arrayBuffer())[0]) continue;
      const bytes = new Uint8Array(8192).fill(0x5a);
      bytes.fill(0, 0, 4096);
      const corpus = bytes.subarray(0, 516);
      new TextEncoder().encodeInto(`${path}-journal`, corpus);
      new DataView(bytes.buffer).setUint32(512, 0x800 /* SQLITE_OPEN_MAIN_JOURNAL */);
      bytes.set(new Uint8Array(digest(corpus).buffer), 516);
      for (let attempt = 0; ; attempt++) {
        try {
          const writable = await handle.createWritable();
          await writable.write(bytes);
          await writable.close();
          return;
        } catch (error) {
          if (attempt > 100 || (error as DOMException).name !== "NoModificationAllowedError") throw error;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
    throw new Error("No free pool file");
  }, db);
  await fixture.close();

  const reader = await context.newPage();
  await installWikiApiMocks(reader);
  const telemetry = captureTelemetry(reader);
  await gotoWiki(reader, ROUTE);
  await ready(reader);
  expect(await telemetry.storePath()).toBe("fallback-journal");
  // The leader's SQLite treats it as a hot journal on open (this one has no
  // valid header, so there is nothing to replay) and deletes it; the next boot
  // trusts the local image again.
  telemetry.clear();
  await reader.reload({ waitUntil: "domcontentloaded" });
  await ready(reader);
  expect(await telemetry.storePath()).toBe("fast");
});

test("rapid reloads overlapping the previous leader's writes only use guarded paths", async ({ page }) => {
  test.setTimeout(90_000);
  const telemetry = await persistedReader(page);
  telemetry.clear();
  for (let index = 0; index < 5; index++) await page.reload({ waitUntil: "commit" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await ready(page);
  await telemetry.storePath();
  // Earlier documents may unload before reporting; whatever reported must be a
  // guarded outcome, never an unexplained storage error or an invalid image.
  for (const path of telemetry.paths()) expect(["fast", "leader", "fallback-journal", "fallback-changed"]).toContain(path);
  await page.getByTestId("sidebar-search").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
});

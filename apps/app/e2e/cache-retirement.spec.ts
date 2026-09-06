import { expect, test } from "@playwright/test";
import {
  makePublicWikiSessionIdentity,
  makeWikiStoreId,
  WIKI_PREVIOUS_READER_CACHE_VERSION,
  WIKI_READER_CACHE_VERSION,
} from "@oncobase/wiki-content";
import {
  firstFrameSnapshotKey,
} from "../src/livestore/first-frame-snapshot";
import { publicIdentityStorageKey } from "../src/public-identity";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  waitForPageTitle,
} from "./fixtures";

test("retires only the matching reader-v3 OPFS namespace after v4 hydration", async ({
  baseURL,
  page,
}) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:60001").origin;
  const identity = makePublicWikiSessionIdentity("diana");
  const previousStoreId = makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope: "public",
    origin,
    cacheKey: identity.cacheKey,
    readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
  });
  const matchingDirectory = `livestore-${previousStoreId}@4`;
  const unrelatedDirectory = `${matchingDirectory}-unrelated`;

  await page.addInitScript(
    ({ matching, unrelated }) => {
      const originalGetDirectory = navigator.storage.getDirectory.bind(
        navigator.storage,
      );
      const removed: string[] = [];
      Object.defineProperty(window, "__WIKI_RETIRED_DIRECTORIES__", {
        value: removed,
        configurable: true,
      });
      navigator.storage.getDirectory = async () => {
        const directory = await originalGetDirectory();
        await directory.getDirectoryHandle(matching, { create: true });
        await directory.getDirectoryHandle(unrelated, { create: true });
        const originalRemoveEntry = directory.removeEntry.bind(directory);
        directory.removeEntry = async (name, options) => {
          removed.push(name);
          return originalRemoveEntry(name, options);
        };
        return directory;
      };
    },
    { matching: matchingDirectory, unrelated: unrelatedDirectory },
  );

  await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __WIKI_RETIRED_DIRECTORIES__?: string[];
            }
          ).__WIKI_RETIRED_DIRECTORIES__ ?? [],
      ),
    )
    .toEqual([matchingDirectory]);
});

test("keeps a validated N-1 first frame offline until current hydration retires it", async ({
  baseURL,
  page,
}) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:60001").origin;
  const identity = makePublicWikiSessionIdentity("diana");
  const pathname = "/wiki/logistics/insurance";
  const previousSnapshotKey = firstFrameSnapshotKey(
    origin,
    WIKI_PREVIOUS_READER_CACHE_VERSION,
  );
  const currentSnapshotKey = firstFrameSnapshotKey(origin);
  const identityKey = publicIdentityStorageKey(`${origin}|${origin}`);
  const previousStoreId = makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope: "public",
    origin,
    cacheKey: identity.cacheKey,
    readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
  });
  const matchingDirectory = `livestore-${previousStoreId}@4`;
  const previousHtml = [
    '<div class="prototype-shell">',
    '<aside data-test-id="wiki-sidebar">N-1 navigation</aside>',
    '<article data-test-id="document-article">',
    "<h1>Insurance from N-1</h1>",
    "<p>N-1 OFFLINE SNAPSHOT remains readable.</p>",
    '<a href="/about/About">Cached link</a>',
    "</article>",
    "</div>",
  ].join("");

  await page.addInitScript(
    ({
      currentKey,
      identityKey: seededIdentityKey,
      matching,
      pathname: seededPathname,
      previousHtml: seededPreviousHtml,
      previousKey,
      previousReader,
      publicIdentity,
    }) => {
      localStorage.removeItem(currentKey);
      localStorage.setItem(seededIdentityKey, JSON.stringify(publicIdentity));
      localStorage.setItem(
        previousKey,
        JSON.stringify({
          html: seededPreviousHtml,
          pathname: seededPathname,
          readerCacheVersion: previousReader,
          validatedAt: 1,
        }),
      );
      const testWindow = window as typeof window & {
        __WIKI_RETIRED_DIRECTORIES__?: string[];
        __WIKI_TEST_ONLINE__?: boolean;
      };
      testWindow.__WIKI_TEST_ONLINE__ = false;
      Object.defineProperty(window.navigator, "onLine", {
        configurable: true,
        get: () => testWindow.__WIKI_TEST_ONLINE__ === true,
      });

      const originalGetDirectory = navigator.storage.getDirectory.bind(
        navigator.storage,
      );
      const removed: string[] = [];
      Object.defineProperty(window, "__WIKI_RETIRED_DIRECTORIES__", {
        value: removed,
        configurable: true,
      });
      navigator.storage.getDirectory = async () => {
        const directory = await originalGetDirectory();
        await directory.getDirectoryHandle(matching, { create: true });
        const originalRemoveEntry = directory.removeEntry.bind(directory);
        directory.removeEntry = async (name, options) => {
          removed.push(name);
          return originalRemoveEntry(name, options);
        };
        return directory;
      };
    },
    {
      currentKey: currentSnapshotKey,
      identityKey,
      matching: matchingDirectory,
      pathname,
      previousHtml,
      previousKey: previousSnapshotKey,
      previousReader: WIKI_PREVIOUS_READER_CACHE_VERSION,
      publicIdentity: identity,
    },
  );

  const requests = await installWikiApiMocks(page);
  requests.setSessionIdentityFailure(true);
  await page.goto(pathname, { waitUntil: "domcontentloaded" });

  const firstFrame = page.locator("#wiki-first-frame-snapshot");
  await expect(firstFrame).toBeVisible();
  await expect(firstFrame).toContainText("N-1 OFFLINE SNAPSHOT remains readable.");
  await expect(firstFrame).toHaveAttribute(
    "data-reader-cache-version",
    WIKI_PREVIOUS_READER_CACHE_VERSION,
  );
  await expect(firstFrame).toHaveAttribute("data-read-only", "true");
  await firstFrame.getByRole("link", { name: "Cached link" }).click();
  await expect(page).toHaveURL(new RegExp(`${pathname}$`));
  await expect(page.locator("#root")).toHaveCSS("visibility", "hidden");
  expect(requests.manifest).toHaveLength(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), previousSnapshotKey),
  ).not.toBeNull();

  requests.setSessionIdentityFailure(false);
  await page.evaluate(() => {
    const testWindow = window as typeof window & {
      __WIKI_TEST_ONLINE__?: boolean;
    };
    testWindow.__WIKI_TEST_ONLINE__ = true;
    window.dispatchEvent(new Event("online"));
  });

  await waitForPageTitle(page, "Insurance");
  await expect(documentArticle(page)).toContainText("Claims follow-up");
  await expect(firstFrame).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.dataset.wikiFirstFrameVersion ?? null,
      ),
    )
    .toBeNull();
  expect(requests.manifest).toHaveLength(1);
  const snapshots = await page.evaluate(
    ({ currentKey, previousKey }) => ({
      current: localStorage.getItem(currentKey),
      previous: localStorage.getItem(previousKey),
    }),
    { currentKey: currentSnapshotKey, previousKey: previousSnapshotKey },
  );
  expect(snapshots.previous).toBeNull();
  expect(JSON.parse(snapshots.current ?? "{}")).toMatchObject({
    pathname,
    readerCacheVersion: WIKI_READER_CACHE_VERSION,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __WIKI_RETIRED_DIRECTORIES__?: string[];
            }
          ).__WIKI_RETIRED_DIRECTORIES__ ?? [],
      ),
    )
    .toContain(matchingDirectory);
});

test("retires stale first-frame HTML when the refreshed public manifest makes the route sensitive", async ({
  baseURL,
  page,
}) => {
  const origin = new URL(baseURL ?? "http://127.0.0.1:60001").origin;
  const identity = makePublicWikiSessionIdentity("diana");
  const pathname = "/wiki/logistics/insurance";
  const previousSnapshotKey = firstFrameSnapshotKey(
    origin,
    WIKI_PREVIOUS_READER_CACHE_VERSION,
  );
  const identityKey = publicIdentityStorageKey(`${origin}|${origin}`);
  const previousStoreId = makeWikiStoreId({
    siteSlug: identity.siteSlug,
    scope: "public",
    origin,
    cacheKey: identity.cacheKey,
    readerCacheVersion: WIKI_PREVIOUS_READER_CACHE_VERSION,
  });
  const matchingDirectory = `livestore-${previousStoreId}@4`;
  const previousHtml = [
    '<div class="prototype-shell">',
    '<aside data-test-id="wiki-sidebar">N-1 navigation</aside>',
    '<article data-test-id="document-article">',
    "<h1>Insurance from N-1</h1>",
    "<p>FORMERLY PUBLIC CONTENT must disappear.</p>",
    "</article>",
    "</div>",
  ].join("");

  await page.addInitScript(
    ({
      identityKey: seededIdentityKey,
      matching,
      pathname: seededPathname,
      previousHtml: seededPreviousHtml,
      previousKey,
      previousReader,
      publicIdentity,
    }) => {
      localStorage.setItem(seededIdentityKey, JSON.stringify(publicIdentity));
      localStorage.setItem(
        previousKey,
        JSON.stringify({
          html: seededPreviousHtml,
          pathname: seededPathname,
          readerCacheVersion: previousReader,
          validatedAt: 1,
        }),
      );

      const originalGetDirectory = navigator.storage.getDirectory.bind(
        navigator.storage,
      );
      const removed: string[] = [];
      Object.defineProperty(window, "__WIKI_RETIRED_DIRECTORIES__", {
        value: removed,
        configurable: true,
      });
      navigator.storage.getDirectory = async () => {
        const directory = await originalGetDirectory();
        await directory.getDirectoryHandle(matching, { create: true });
        const originalRemoveEntry = directory.removeEntry.bind(directory);
        directory.removeEntry = async (name, options) => {
          removed.push(name);
          return originalRemoveEntry(name, options);
        };
        return directory;
      };
    },
    {
      identityKey,
      matching: matchingDirectory,
      pathname,
      previousHtml,
      previousKey: previousSnapshotKey,
      previousReader: WIKI_PREVIOUS_READER_CACHE_VERSION,
      publicIdentity: identity,
    },
  );

  const requests = await installWikiApiMocks(page, {
    pageOverrides: {
      "wiki/logistics/insurance": { sensitive: true },
    },
  });
  await page.goto(pathname, { waitUntil: "domcontentloaded" });

  const firstFrame = page.locator("#wiki-first-frame-snapshot");
  await expect(firstFrame).toContainText("FORMERLY PUBLIC CONTENT must disappear.");
  await expect.poll(() => requests.manifest.length).toBe(1);
  await expect(firstFrame).toHaveCount(0);
  await expect(page.locator("#root")).toHaveCSS("visibility", "visible");
  await expect(documentArticle(page).getByText("Page not found")).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), previousSnapshotKey),
  ).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __WIKI_RETIRED_DIRECTORIES__?: string[];
            }
          ).__WIKI_RETIRED_DIRECTORIES__ ?? [],
      ),
    )
    .toContain(matchingDirectory);
});

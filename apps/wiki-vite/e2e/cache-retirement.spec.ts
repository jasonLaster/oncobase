import { expect, test } from "@playwright/test";
import {
  makePublicWikiSessionIdentity,
  makeWikiStoreId,
} from "@oncobase/wiki-content";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

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
    readerCacheVersion: "reader-v3",
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

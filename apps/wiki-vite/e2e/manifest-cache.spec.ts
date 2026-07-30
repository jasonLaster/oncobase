import { expect, test } from "@playwright/test";
import {
  documentArticle,
  gotoWiki,
  installWikiApiMocks,
  openDirectory,
  waitForPageTitle,
} from "./fixtures";

const REFRESH_MANIFEST_EVENT = "wiki-vite:refresh-manifest";
const PUBLIC_MANIFEST_FRESH_MS = 60_000;
const slug = "wiki/logistics/insurance";

test.describe("durable manifest refresh", () => {
  test("reuses a fresh persisted manifest after reload and across route changes", async ({
    page,
  }) => {
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, `/${slug}`);
    await waitForPageTitle(page, "Insurance");
    expect(requests.manifest).toHaveLength(1);

    await page.reload();
    await waitForPageTitle(page, "Insurance");
    expect(requests.manifest).toHaveLength(1);

    await page.getByTestId("wiki-sidebar").getByRole("link", {
      name: "index",
      exact: true,
    }).click();
    await waitForPageTitle(page, "Diana Wiki Home");
    expect(requests.manifest).toHaveLength(1);
  });

  test("automatically revalidates an expired public manifest without blanking stale content", async ({
    page,
  }) => {
    await page.clock.install({
      time: new Date("2026-07-30T12:00:00.000Z"),
    });
    const manifestValidators: Array<string | undefined> = [];
    let initialEtag: string | undefined;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/wiki/manifest") {
        manifestValidators.push(request.headers()["if-none-match"]);
      }
    });
    page.on("response", (response) => {
      if (
        new URL(response.url()).pathname === "/api/wiki/manifest" &&
        response.status() === 200
      ) {
        initialEtag = response.headers()["etag"];
      }
    });
    const requests = await installWikiApiMocks(page, {
      pageOverrides: {
        [slug]: { content: "# Insurance\n\nOLD TTL SNAPSHOT remains readable." },
      },
    });

    await gotoWiki(page, `/${slug}`);
    await expect(documentArticle(page)).toContainText("OLD TTL SNAPSHOT");
    await expect.poll(() => initialEtag).toMatch(/^W\/"[a-f0-9]+"$/);
    expect(requests.manifest).toHaveLength(1);

    await page.clock.fastForward(PUBLIC_MANIFEST_FRESH_MS / 2);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForPageTitle(page, "Insurance");
    await expect(documentArticle(page)).toContainText("OLD TTL SNAPSHOT");
    expect(requests.manifest).toHaveLength(1);

    requests.setPageOverride(slug, {
      content: "# Insurance\n\nNEW TTL SNAPSHOT arrived automatically.",
    });
    requests.setManifestDelay(2_000);
    await page.clock.fastForward(PUBLIC_MANIFEST_FRESH_MS / 2 + 1);

    await expect.poll(() => requests.manifest.length).toBe(2);
    expect(manifestValidators[1]).toBe(initialEtag);
    await expect(documentArticle(page)).toContainText("OLD TTL SNAPSHOT");
    await expect(documentArticle(page)).toContainText(
      "NEW TTL SNAPSHOT arrived automatically.",
      { timeout: 10_000 },
    );
    await expect(documentArticle(page)).not.toContainText("OLD TTL SNAPSHOT");
  });

  test("keeps stale content visible while a changed manifest replaces it", async ({
    page,
  }) => {
    const requests = await installWikiApiMocks(page, {
      pageOverrides: {
        [slug]: { content: "# Insurance\n\nOLD SNAPSHOT remains readable." },
      },
    });
    await gotoWiki(page, `/${slug}`);
    await expect(documentArticle(page)).toContainText("OLD SNAPSHOT");

    requests.setPageOverride(slug, {
      content: "# Insurance\n\nNEW SNAPSHOT arrived in the background.",
    });
    requests.setManifestDelay(500);
    await page.evaluate((eventName) => {
      window.dispatchEvent(new Event(eventName));
    }, REFRESH_MANIFEST_EVENT);

    await expect(documentArticle(page)).toContainText("OLD SNAPSHOT");
    await expect(documentArticle(page)).toContainText("NEW SNAPSHOT");
    expect(requests.manifest).toHaveLength(2);
  });

  test("retains the persisted snapshot when background validation fails", async ({
    page,
  }) => {
    const requests = await installWikiApiMocks(page, {
      pageOverrides: {
        [slug]: { content: "# Insurance\n\nFALLBACK SNAPSHOT stays available." },
      },
    });
    await gotoWiki(page, `/${slug}?devtools=1`);
    await expect(documentArticle(page)).toContainText("FALLBACK SNAPSHOT");

    requests.setManifestFailure(true);
    await page.evaluate((eventName) => {
      window.dispatchEvent(new Event(eventName));
    }, REFRESH_MANIFEST_EVENT);

    await expect
      .poll(() =>
        page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.metrics?.message),
      )
      .toBe("Refresh failed; using cached manifest");
    await expect(documentArticle(page)).toContainText("FALLBACK SNAPSHOT");
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
  });

  test("ignores a partial refresh when a complete snapshot is persisted", async ({
    page,
  }) => {
    const requests = await installWikiApiMocks(page);
    await gotoWiki(page, `/${slug}?devtools=1`);
    await expect(documentArticle(page)).toContainText("Claims follow-up");

    requests.setManifestPartial(true);
    await page.evaluate((eventName) => {
      window.dispatchEvent(new Event(eventName));
    }, REFRESH_MANIFEST_EVENT);

    await expect
      .poll(() =>
        page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.metrics?.message),
      )
      .toBe("Partial refresh ignored; using complete cached manifest");
    await expect(documentArticle(page)).toContainText("Claims follow-up");
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }),
    ).toBeVisible();
  });

  test("uses a first-boot partial manifest provisionally and keeps retrying", async ({
    page,
  }) => {
    const requests = await installWikiApiMocks(page, { manifestPartial: true });
    await gotoWiki(page, "/?devtools=1");
    await waitForPageTitle(page, "Diana Wiki Home");
    await expect
      .poll(() =>
        page.evaluate(() => window.__WIKI_VITE_OBSERVABILITY__?.metrics?.message),
      )
      .toBe("Provisional manifest loaded; retrying full manifest");
    expect(requests.manifest).toHaveLength(1);

    await page.reload();
    await waitForPageTitle(page, "Diana Wiki Home");
    await expect.poll(() => requests.manifest.length).toBe(2);

    requests.setManifestPartial(false);
    await page.evaluate((eventName) => {
      window.dispatchEvent(new Event(eventName));
    }, REFRESH_MANIFEST_EVENT);
    await expect.poll(() => requests.manifest.length).toBe(3);
    await expect(page.getByRole("button", { name: "Expand logistics" })).toBeVisible();
    await openDirectory(page, "logistics");
    await expect(
      page.getByTestId("wiki-sidebar").getByRole("link", { name: "insurance" }),
    ).toBeVisible();
  });

  test("paints the persisted public page and navigation before a delayed refresh", async ({
    page,
  }) => {
    const requests = await installWikiApiMocks(page, {
      pageOverrides: {
        [slug]: { content: "# Insurance\n\nOLD FIRST FRAME remains visible." },
      },
    });
    await gotoWiki(page, `/${slug}`);
    await expect(documentArticle(page)).toContainText("OLD FIRST FRAME");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some((key) =>
            key.startsWith("wiki-vite:first-frame:reader-v4:"),
          ),
        ),
      )
      .toBe(true);

    requests.setPageOverride(slug, {
      content: "# Insurance\n\nNEW FIRST FRAME arrived after refresh.",
    });
    requests.setManifestDelay(2_000);
    await page.reload({ waitUntil: "domcontentloaded" });

    const firstFrame = page.locator("#wiki-first-frame-snapshot");
    await expect(firstFrame).toBeVisible({ timeout: 250 });
    await expect(firstFrame.getByTestId("document-article")).toContainText(
      "OLD FIRST FRAME",
      { timeout: 250 },
    );
    await expect(firstFrame.getByTestId("wiki-sidebar")).toContainText(
      "insurance",
      { timeout: 250 },
    );
    expect(await page.title()).toBe("TNBC Knowledge Base");

    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.dataset.wikiFirstFrame ?? null,
        ),
      )
      .toBeNull();
    await page.evaluate((eventName) => {
      window.dispatchEvent(new Event(eventName));
    }, REFRESH_MANIFEST_EVENT);
    await page.waitForTimeout(500);
    await expect(documentArticle(page)).toContainText("OLD FIRST FRAME");
    await expect(documentArticle(page)).toContainText(
      "NEW FIRST FRAME arrived after refresh.",
      { timeout: 10_000 },
    );
    await expect(page).toHaveTitle("Insurance — TNBC Knowledge Base");
  });
});

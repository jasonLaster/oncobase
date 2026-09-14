import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";
import { injectPageBootstrap } from "../server/page-bootstrap";

const content = "# Bootstrap fixture\n\nCSR_DATA_BODY\n\n[Insurance](/wiki/logistics/insurance)";
const record = { slug: "index", title: "Bootstrap fixture", content, sensitive: false, tags: [],
  contentHash: createHash("sha256").update(`index:${content}`).digest("hex").slice(0, 24) };
for (const sessionAuthenticated of [false, true]) {
  test(`CSR seeds data without a body request; session=${sessionAuthenticated}`, async ({ page }) => {
    const api = await installWikiApiMocks(page, { sessionAuthenticated, pageOverrides: { index: record } });
    const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (route.request().resourceType() !== "document" || url.pathname !== "/") return route.fallback();
      await route.fulfill({ contentType: "text/html", body: injectPageBootstrap(template, record, url, "diana") });
    });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/");
    await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
    expect(await page.evaluate(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length)).toBe(1);
    expect(api.pages.filter(value => new URL(value).searchParams.get("slugs")?.split(",").includes("index"))).toHaveLength(0);
    await expect(page.locator("#wiki-html-first, #wiki-page-bootstrap")).toHaveCount(0);
    await page.getByTestId("document-article").getByRole("link", { name: "Insurance", exact: true }).click();
    await expect(page.getByTestId("document-article")).toContainText("Prior authorization");
    await page.goBack();
    await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
    api.setPageOverride("index", { content: "# Revised\n\nUPDATED_BODY" });
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect(page.getByTestId("document-article")).toContainText("UPDATED_BODY");
    api.setPageOverride("index", { sensitive: true });
    if (!sessionAuthenticated) {
      await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
      await expect(page.getByTestId("document-article")).not.toContainText("UPDATED_BODY");
    }
    expect(errors).toEqual([]);
  });
}

test("an invalid CSR payload falls back to the body API", async ({ page }) => {
  const api = await installWikiApiMocks(page, { pageOverrides: { index: record } });
  const template = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() !== "document") return route.fallback();
    await route.fulfill({ contentType: "text/html", body: injectPageBootstrap(template, record, url, "wrong-site") });
  });
  await page.goto("/");
  await expect(page.getByTestId("document-article")).toContainText("CSR_DATA_BODY");
  expect(api.pages.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => performance.getEntriesByName("wiki-page-bootstrap-seeded").length)).toBe(0);
});

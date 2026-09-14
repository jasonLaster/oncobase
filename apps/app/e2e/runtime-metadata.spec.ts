import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";

test("unchanged JavaScript reports the current HTML deployment metadata after reload", async ({ page }) => {
  await installWikiApiMocks(page);
  const template = (await readFile(new URL("../dist/index.html", import.meta.url), "utf8"))
    .replace(/<meta\b[^>]*name="wiki-build-commit"[^>]*>/g, "");
  let commitSha = "a".repeat(40);
  await page.route("**/*", async route => {
    if (route.request().resourceType() !== "document") return route.fallback();
    await route.fulfill({ contentType: "text/html", body: template.replace("</head>",
      `<meta name="wiki-build-commit" content="${commitSha}"></head>`) });
  });
  const runtimeSha = () => page.evaluate(() => (window as unknown as {
    __WIKI_VITE_OBSERVABILITY__?: { runtime?: { commitSha?: string } };
  }).__WIKI_VITE_OBSERVABILITY__?.runtime?.commitSha);
  await page.goto("/");
  await expect.poll(runtimeSha).toBe(commitSha);
  const entry = await page.locator('script[type="module"][src]').getAttribute("src");
  commitSha = "b".repeat(40);
  await page.reload();
  await expect.poll(runtimeSha).toBe(commitSha);
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute("src", entry!);
  await expect(page.getByTestId("sidebar-search")).toBeVisible();
});

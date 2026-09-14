import { expect, test } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

const mathSource = "# Insurance\n\nNew equations: $x^2$.\n\n``` math\nx+y\n```\n\n<code class=\"math-inline\">z^2</code>\n\nCost $200/month.";
const mathChunk = /\/(?:vendor-math-[^/]+\.js|.*rehype-katex.*)$/;

test("ordinary articles do not load the math engine; equations retain all render modes", async ({ page }) => {
  await installWikiApiMocks(page, { pageOverrides: { "about/About": { title: "Insurance", content: mathSource } } });
  const requests: string[] = [];
  page.on("request", request => { if (mathChunk.test(new URL(request.url()).pathname)) requests.push(request.url()); });
  await gotoWiki(page, "/wiki/logistics/insurance");
  expect(requests).toHaveLength(0);
  await gotoWiki(page, "/about/About");
  await expect(documentArticle(page).locator(".katex")).toHaveCount(3);
  await expect(documentArticle(page)).toContainText("Cost $200/month.");
  expect(requests.length).toBeGreaterThan(0);
});

test("a background edit introducing math keeps the previous article mounted until ready", async ({ page }) => {
  const api = await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  const original = await documentArticle(page).locator(".wiki-markdown").elementHandle();
  expect(original).toBeTruthy();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route(mathChunk, async route => { requested = true; await held; await route.fallback(); });
  try {
    api.setPageOverride("wiki/logistics/insurance", { content: mathSource });
    await page.evaluate(() => window.dispatchEvent(new Event("wiki-vite:refresh-manifest")));
    await expect.poll(() => requested).toBe(true);
    await expect(documentArticle(page)).toContainText("Prior authorization");
    expect(await original!.evaluate(node => node.isConnected)).toBe(true);
    release();
    await expect(documentArticle(page).locator(".katex")).toHaveCount(3);
    expect(await original!.evaluate(node => node.isConnected)).toBe(true);
    await expect(page.getByTestId("page-loading")).toHaveCount(0);
  } finally { release(); }
});

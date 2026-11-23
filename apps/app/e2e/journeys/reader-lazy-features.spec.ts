import { expect, test, type Page } from "@playwright/test";
import { documentArticle, gotoWiki, installWikiApiMocks } from "../fixtures";

const slideChunk = /\/(?:slides-viewer-[^/]+\.js|slides-viewer\.tsx)(?:\?.*)?$/;
const theaterChunk = /\/(?:image-theater-modal-[^/]+\.js|image-theater-modal\.tsx)(?:\?.*)?$/;
const tableChunk = /\/enhance-table-[^/]+\.js(?:\?.*)?$/;
const redirectsChunk = /\/(?:configured-redirects-[^/]+\.js|configured-redirects\.ts)(?:\?.*)?$/;
const waterfallChunk = /\/(?:scenario-waterfall-[^/]+\.js|scenario-waterfall\.tsx)(?:\?.*)?$/;
const fixtureSlug = "wiki/fixture";

async function setup(page: Page, source: string, extraPages: Record<string, { title: string; tags: string[]; content: string }> = {}) {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await installWikiApiMocks(page, {
    omitBasePages: true,
    pageOverrides: {
      [fixtureSlug]: { title: "Fixture", tags: [], content: "# Fixture\n\n" + source },
      ...extraPages,
    },
  });
  return requests;
}

function holdChunk(page: Page, pattern: RegExp) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  return page.route(pattern, async (route) => {
    await held;
    await route.fallback();
  }).then(() => release);
}

const namedSlides = `import { SlidesViewer as Gallery } from "@oncobase/wiki-markdown"

<Gallery fallback="./images/print.png" alt="Print preview" images={[{"src":"images/first.png","alt":"First"},{"src":"images/second.png","alt":"Second"}]} />
`;
const legacySlides = `<!-- slides -->

- ![First](images/first.png)
- ![Second](images/second.png)
`;

test("a cold text reader skips optional chunks even with a fenced slideshow example", async ({ page }) => {
  const requests = await setup(page, 'Plain text.\n\n```html\n<figure data-wiki-slides></figure>\n```');
  await gotoWiki(page, "/" + fixtureSlug);
  await expect(documentArticle(page)).toContainText("Plain text.");
  expect(requests.filter(url => [slideChunk, theaterChunk, tableChunk, waterfallChunk].some(chunk => chunk.test(url)))).toEqual([]);
});

test("the redirect table loads after paint and still resolves an in-app legacy link", async ({ page }) => {
  // A configured alias from redirects.json (also covered by the unit tests).
  const legacy = "/wiki/education/reading-a-tumor";
  await setup(page, `[Old link](${legacy})`, {
    "wiki/education/reading-a-tumor/index": { title: "Destination", tags: [], content: "# Destination\n\nArrived." },
  });
  const release = await holdChunk(page, redirectsChunk);
  await gotoWiki(page, "/" + fixtureSlug);
  // The article paints while the table is still held.
  await expect(documentArticle(page).getByRole("link", { name: "Old link" })).toBeVisible();
  const loaded = page.waitForResponse(redirectsChunk);
  release();
  await loaded;
  await documentArticle(page).getByRole("link", { name: "Old link" }).click();
  await expect(page).toHaveURL(new RegExp(`${legacy}/index$`));
  await expect(documentArticle(page)).toContainText("Arrived.");
});

test("a keyboard-opened image loads the theater and an early Escape cancels the opening", async ({ page }) => {
  const requests = await setup(page, "![Sample figure](images/figure.png)");
  const release = await holdChunk(page, theaterChunk);
  try {
    await gotoWiki(page, "/" + fixtureSlug);
    const opener = documentArticle(page).getByRole("button", { name: "Open image: Sample figure" });
    await expect(opener).toBeVisible();
    expect(requests.some(url => slideChunk.test(url) || theaterChunk.test(url))).toBe(false);

    await opener.press("Enter");
    await expect.poll(() => requests.some(url => theaterChunk.test(url))).toBe(true);
    await page.keyboard.press("Escape");
    const loading = page.waitForResponse(theaterChunk);
    release();
    await loading;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Sample figure" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await expect(dialog.getByRole("link", { name: "Download image" })).toHaveAttribute("href", /figure\.png/);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    release();
  }
});

for (const { name, source, mobile } of [
  { name: "named MDX", source: namedSlides, mobile: false },
  { name: "named MDX", source: namedSlides, mobile: true },
  { name: "legacy markup", source: legacySlides, mobile: false },
  { name: "legacy markup", source: legacySlides, mobile: true },
]) {
  test(`${name} on ${mobile ? "mobile" : "desktop"} renders the first slide and defers the theater`, async ({ browser }) => {
    const page = await browser.newPage({
      baseURL: test.info().project.use.baseURL,
      viewport: mobile ? { width: 393, height: 852 } : { width: 1440, height: 900 },
      hasTouch: mobile,
    });
    try {
      const requests = await setup(page, source);
      const release = await holdChunk(page, slideChunk);
      const viewer = documentArticle(page).locator("[data-wiki-slides]");
      try {
        await gotoWiki(page, "/" + fixtureSlug);
        await expect.poll(() => requests.some(url => slideChunk.test(url))).toBe(true);
        expect(requests.some(url => theaterChunk.test(url))).toBe(false);
        if (source === legacySlides) {
          await expect(viewer.getByRole("img", { name: "First" })).toBeVisible();
          await expect(viewer.locator('img[alt="Second"]')).toBeHidden();
        }
      } finally {
        release();
      }
      await expect(viewer.locator("[data-wiki-slides-status]")).toHaveText("1 / 2");
      await expect(viewer.getByRole("img", { name: "First" })).toBeVisible();
      const next = viewer.getByRole("button", { name: "Next slide" });
      await expect(async () => {
        await next.press("Enter");
        await expect(viewer.locator("[data-wiki-slides-status]")).toHaveText("2 / 2", { timeout: 500 });
      }).toPass();
      await expect(viewer.locator('img[alt="First"]')).toBeHidden();
      expect(requests.some(url => theaterChunk.test(url))).toBe(false);

      const opener = viewer.getByRole("button", { name: "Open image: Second" });
      if (mobile) await opener.tap();
      else await opener.press("Space");
      await expect.poll(() => requests.some(url => theaterChunk.test(url))).toBe(true);
      const dialog = page.getByRole("dialog");
      const enlargedImage = dialog.getByRole("img", { name: "Second" });
      await expect(enlargedImage).toBeVisible();
      expect((await enlargedImage.boundingBox())!.height).toBeGreaterThan((await opener.boundingBox())!.height);
      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByRole("img", { name: "First" })).toBeVisible();
      await expect(dialog.getByText("1 / 2", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();

      if (source === namedSlides) {
        const fallback = documentArticle(page).getByRole("img", { name: "Print preview" });
        await expect(fallback).toBeHidden();
        await page.emulateMedia({ media: "print" });
        await expect(viewer).toBeHidden();
        await expect(fallback).toBeVisible();
      }
    } finally {
      await page.close();
    }
  });
}

test("a scenario walkthrough switches between its waterfall and step-by-step tabs", async ({ page }) => {
  await setup(page, `import { ScenarioWalkthrough } from "@oncobase/wiki-markdown"

<ScenarioWalkthrough
  label="Plan steps"
  domain={[50,90]}
  metrics={[{"label":"Primary","short":"P"},{"label":"Secondary","short":"S"}]}
  steps={[{"label":"Start","values":["60","55"]},{"label":"Drug","detail":"HR 0.76","values":["66","62.5"]}]}
>

- **Step 1.** Start from the baseline.

</ScenarioWalkthrough>
`);
  await gotoWiki(page, "/" + fixtureSlug);
  const article = documentArticle(page);
  const tabs = article.getByRole("tablist", { name: "Show the steps as" });
  const chart = article.getByRole("table", { name: "Plan steps" });
  const text = article.getByText("Start from the baseline.");
  await expect(tabs.getByRole("tab", { name: "Waterfall" })).toHaveAttribute("aria-selected", "true");
  await expect(chart).toBeVisible();
  await expect(text).toBeHidden();
  await tabs.getByRole("tab", { name: "Step by step" }).click();
  await expect(text).toBeVisible();
  await expect(chart).toBeHidden();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.getByRole("tab", { name: "Waterfall" })).toBeFocused();
  await expect(chart).toBeVisible();
  await expect(text).toBeHidden();
});

test("native table cells and keyboard scrolling are available while SmartTable downloads", async ({ page }) => {
  const requests = await setup(page, "| Item | Count |\n| --- | --- |\n| Sample | 42 |\n\nText after the table.");
  const release = await holdChunk(page, tableChunk);
  try {
    await gotoWiki(page, "/" + fixtureSlug);
    await expect.poll(() => requests.some(url => tableChunk.test(url))).toBe(true);
    const article = documentArticle(page);
    await expect(article.getByRole("cell", { name: "Sample" })).toBeVisible();
    const wrapper = article.locator("[data-smart-table-wrapper]");
    await wrapper.focus();
    await expect(wrapper).toBeFocused();
    const following = article.getByText("Text after the table.");
    const initialY = (await following.boundingBox())!.y;
    await expect(article.getByLabel("Resize column 1")).toHaveCount(0);
    release();

    await expect(article.getByLabel("Resize column 1")).toBeAttached();
    expect(Math.abs((await following.boundingBox())!.y - initialY)).toBeLessThan(2);
    expect(requests.some(url => slideChunk.test(url) || theaterChunk.test(url))).toBe(false);
  } finally {
    release();
  }
});

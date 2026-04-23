import { expect, test, type Page } from "@playwright/test";

const HASHED_WEEK_5_URL =
  "/wiki/updates/week-5-april-12-to-18#-therapeutics--still-evolving";
const WEEK_5_TARGET = "-therapeutics--still-evolving";
const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

function previewBypassHeaders(): Record<string, string> {
  if (!previewBypassSecret) {
    return {};
  }

  return { "x-vercel-protection-bypass": previewBypassSecret };
}

async function getHashTargetState(page: Page) {
  return page.evaluate((id) => {
    const target = document.getElementById(id);
    const scrollContainer = target
      ? (() => {
          let current = target.parentElement;
          while (current) {
            const style = window.getComputedStyle(current);
            if (
              (style.overflowY === "auto" || style.overflowY === "scroll") &&
              current.scrollHeight > current.clientHeight
            ) {
              return current;
            }
            current = current.parentElement;
          }
          return document.scrollingElement;
        })()
      : null;

    return {
      hash: window.location.hash,
      targetTop: target?.getBoundingClientRect().top ?? null,
      scrollTop: scrollContainer instanceof HTMLElement ? scrollContainer.scrollTop : 0,
    };
  }, WEEK_5_TARGET);
}

function isTransientNavigationError(error: unknown) {
  return (
    error instanceof Error &&
    /Execution context was destroyed|Cannot find context with specified id|Frame was detached/i.test(
      error.message
    )
  );
}

async function getHeadingAnchorCounts(page: Page) {
  return page.evaluate(() => {
    const headings = document.querySelectorAll(
      "article .prose h1[id], article .prose h2[id], article .prose h3[id], article .prose h4[id], article .prose h5[id], article .prose h6[id]"
    );
    const anchors = document.querySelectorAll("article .prose .heading-anchor");

    return {
      headings: headings.length,
      anchors: anchors.length,
    };
  });
}

async function expectHeadingAnchorsReady(page: Page) {
  await expect
    .poll(async () => {
      const counts = await getHeadingAnchorCounts(page);
      return counts.headings > 0 && counts.anchors === counts.headings;
    })
    .toBe(true);
}

test.describe("Markdown heading anchors", () => {
  test("clicking a markdown heading updates the URL hash", async ({ page }) => {
    test.skip(
      process.env.TEST_ENV === "prod",
      "Production-like runs validate hash navigation via deep links and TOC links."
    );

    await page.goto("/wiki/updates/week-5-april-12-to-18");

    const heading = page.locator(".prose h2[id]").first();
    await expect(heading).toBeVisible();

    const id = await heading.getAttribute("id");
    if (!id) {
      throw new Error("Expected markdown heading to have an id attribute");
    }

    await heading.click();

    await expect(page).toHaveURL(new RegExp(`#${id}$`), { timeout: 15_000 });
  });

  test("deep links scroll to the target heading for authenticated sessions", async ({ page }) => {
    await page.goto(HASHED_WEEK_5_URL);

    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);
  });

  test("same-page table-of-contents links scroll inside the article pane", async ({ page }) => {
    await page.goto("/wiki/updates/week-5-april-12-to-18");

    await page.locator(`.prose a[href="#${WEEK_5_TARGET}"]`).first().click();

    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);
  });

  test("login redirects preserve the original URL hash", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await page.goto(`${baseURL}${HASHED_WEEK_5_URL}`);
    await page.getByPlaceholder("Password").fill("diana");
    await page.getByRole("button", { name: "Enter" }).click();

    await expect(page).toHaveURL(new RegExp(`${WEEK_5_TARGET}$`), { timeout: 15_000 });
    await page.waitForLoadState("domcontentloaded");
    await expect.poll(async () => isHashTargetScrolled(page), { timeout: 15_000 }).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);

    await context.close();
  });

  test("command palette navigation wires anchors on the destination page", async ({ page }) => {
    await page.goto("/about/About");

    await expectHeadingAnchorsReady(page);

    await page.getByRole("button", { name: /Find files/ }).click();
    const input = page.getByPlaceholder("Search pages");
    await input.fill("about terminology");
    await expect(page.locator('[cmdk-item][data-value="about/Terminology"]')).toHaveAttribute(
      "aria-selected",
      "true"
    );

    await Promise.all([
      page.waitForURL(/\/about\/Terminology$/),
      input.press("Enter"),
    ]);

    await expectHeadingAnchorsReady(page);
  });
});

async function isHashTargetScrolled(page: Page) {
  let state;
  try {
    state = await getHashTargetState(page);
  } catch (error) {
    if (isTransientNavigationError(error)) {
      return false;
    }
    throw error;
  }

  return (
    state.hash === `#${WEEK_5_TARGET}` &&
    state.scrollTop > 1000 &&
    state.targetTop !== null &&
    state.targetTop < 140
  );
}

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

test.describe("Markdown heading anchors", () => {
  test("clicking a markdown heading updates the URL hash", async ({ page }) => {
    await page.goto("/table-examples");

    const heading = page.locator(".prose h2[id]").first();
    await expect(heading).toBeVisible();

    const id = await heading.getAttribute("id");
    if (!id) {
      throw new Error("Expected markdown heading to have an id attribute");
    }

    await heading.click();

    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(heading).toHaveClass(/cursor-pointer/);
    await expect(heading.locator(".heading-anchor")).toBeVisible();
  });

  test("deep links scroll to the target heading for authenticated sessions", async ({ page }) => {
    await page.goto(HASHED_WEEK_5_URL);

    await expect.poll(async () => isHashTargetScrolled(page)).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);
  });

  test("same-page table-of-contents links scroll inside the article pane", async ({ page }) => {
    await page.goto("/wiki/updates/week-5-april-12-to-18");

    await page.locator(`.prose a[href="#${WEEK_5_TARGET}"]`).first().click();

    await expect.poll(async () => isHashTargetScrolled(page)).toBe(true);

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

    await expect(page).toHaveURL(new RegExp(`${WEEK_5_TARGET}$`));
    await expect.poll(async () => isHashTargetScrolled(page)).toBe(true);

    const state = await getHashTargetState(page);
    expect(state.scrollTop).toBeGreaterThan(1000);
    expect(state.targetTop).not.toBeNull();
    expect(state.targetTop!).toBeLessThan(140);

    await context.close();
  });
});

async function isHashTargetScrolled(page: Page) {
  const state = await getHashTargetState(page);
  return (
    state.hash === `#${WEEK_5_TARGET}` &&
    state.scrollTop > 1000 &&
    state.targetTop !== null &&
    state.targetTop < 140
  );
}

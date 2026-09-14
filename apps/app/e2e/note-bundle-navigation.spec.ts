import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

const base = "sources/meeting-notes/09-13---care-planning";

for (const mobile of [false, true]) {
  test(`note pages link to their siblings on ${mobile ? "mobile" : "desktop"}`, async ({ page }, testInfo) => {
    const formatted = mobile ? "transcript-formatted" : "formatted";
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await installWikiApiMocks(page, {
      pageOverrides: Object.fromEntries(["overview", formatted, "raw"].map((part) => [
        `${base}-${part}`,
        {
          title: `Care planning — ${part}`,
          tags: [],
          content: `# Care planning — ${part}\n\nMeeting notes for September 13.\n\n## Discussion\n\nReview the upcoming appointments and questions for the care team.`,
        },
      ])),
    });
    await gotoWiki(page, `/${base}-${formatted}`);
    await waitForPageTitle(page, `Care planning — ${formatted}`);
    if (mobile) await page.evaluate(() => document.documentElement.classList.add("dark"));

    const navigation = page.getByRole("navigation", { name: "Note pages" });
    await expect(navigation.getByRole("link")).toHaveCount(3);
    await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", `/${base}-${formatted}`);
    await navigation.getByRole("link", { name: /^Raw/ }).click();
    await waitForPageTitle(page, "Care planning — raw");
    await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", `/${base}-raw`);
    await expect(navigation).toBeInViewport();
    const bounds = await navigation.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: testInfo.outputPath("note-navigation.png") });

    await navigation.getByRole("link", { name: /^Overview/ }).focus();
    await page.keyboard.press("Enter");
    await waitForPageTitle(page, "Care planning — overview");
    await expect(navigation.locator('[aria-current="page"]')).toHaveAttribute("href", `/${base}-overview`);
    await navigation.getByRole("link", { name: /^Formatted/ }).click();
    await waitForPageTitle(page, `Care planning — ${formatted}`);
  });
}

test("note navigation only includes available siblings and stays off unrelated pages", async ({ page }) => {
  await installWikiApiMocks(page, {
    pageOverrides: Object.fromEntries([
      `${base}-raw`, `${base}-formatted`, "archive/09-13---care-planning-overview",
    ].map((slug) => [slug, { title: slug, tags: [], content: `# ${slug}` }])),
  });
  await gotoWiki(page, `/${base}-raw`);
  await waitForPageTitle(page, `${base}-raw`);
  const navigation = page.getByRole("navigation", { name: "Note pages" });
  await expect(navigation.getByRole("link")).toHaveCount(2);
  await expect(navigation.getByRole("link", { name: /^Overview/ })).toHaveCount(0);
  await gotoWiki(page, "/about/About");
  await waitForPageTitle(page, "About This Wiki");
  await expect(navigation).toHaveCount(0);
});

for (const selection of ["click", "Enter"] as const) {
  test(`notes bundle opens its overview with ${selection}`, async ({ page }) => {
    const base = "sources/meeting-notes/09-13---care-planning";
    await installWikiApiMocks(page, {
      pageOverrides: Object.fromEntries(["raw", "formatted", "overview"].map((part) => [
        `${base}-${part}`,
        { title: `Care planning ${part}`, tags: [], content: `# Care planning ${part}` },
      ])),
    });
    await gotoWiki(page, "/");
    await page.evaluate((base) => {
      localStorage.setItem("cmd-palette-recent", JSON.stringify([
        `${base}-raw`, `${base}-formatted`,
      ]));
    }, base);
    await page.getByTestId("sidebar-search").click();
    const palette = page.getByTestId("command-palette");
    await expect(palette.getByRole("option").first()).toContainText("care planning overview");
    const input = page.getByTestId("command-palette-input");
    await input.fill("care planning");
    await expect(palette.getByRole("option")).toHaveCount(1);
    await expect(palette.getByRole("option")).toHaveAttribute("data-value", `${base}-overview`);
    if (selection === "click") await palette.getByRole("option").click();
    else await input.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${base}-overview$`));
    await waitForPageTitle(page, "Care planning overview");
  });
}

import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

test.describe("Command palette parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("palette trigger opens local page navigation", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("sidebar-search").click();
    await page.getByTestId("command-palette-input").fill("about");
    await page.getByRole("option", { name: /About This Wiki/ }).click();

    await expect(page).toHaveURL(/\/about\/About$/);
    await waitForPageTitle(page, "About This Wiki");
  });

  test("Cmd+K opens the fuzzy file palette with no top mode tabs", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByRole("button", { name: "Pages" })).toHaveCount(0);
    await page.getByTestId("command-palette-input").fill("wiki/");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page).not.toHaveURL(/\/$/);
    await expect(page.getByTestId("document-article")).toBeVisible();
  });

  test("palette exposes active result semantics for keyboard users", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("sidebar-search").click();
    const input = page.getByTestId("command-palette-input");
    await input.fill("wiki/");
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-controls", "page-palette-list");
    await expect(page.getByRole("listbox", { name: "pages results" })).toBeVisible();

    await page.keyboard.press("ArrowDown");
    const activeId = await input.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    await expect(page.locator(`#${activeId}`)).toHaveAttribute("aria-selected", "true");
  });

  test("file palette shows pages before typing when there are no recents", async ({ page }) => {
    await gotoWiki(page, "/");
    await page.evaluate(() => {
      localStorage.removeItem("cmd-palette-recent");
    });

    await page.getByTestId("sidebar-search").click();

    const palette = page.getByTestId("command-palette");
    await expect(palette.getByText("No pages found.")).toHaveCount(0);
    const firstOption = palette.getByRole("option").first();
    await expect(firstOption).toBeVisible();
    await expect(palette.getByRole("option", { name: /Diana Wiki Home/ }).locator("small")).toHaveText(
      "/",
    );
  });

  test("file palette groups recent pages and all pages before typing", async ({ page }) => {
    await gotoWiki(page, "/");
    await page.evaluate(() => {
      localStorage.setItem("cmd-palette-recent", JSON.stringify(["wiki/logistics/insurance"]));
    });

    await page.getByTestId("sidebar-search").click();

    const palette = page.getByTestId("command-palette");
    await expect(palette.getByText("Recent pages")).toBeVisible();
    await expect(palette.getByText("All pages")).toBeVisible();
    await expect(palette.getByRole("option").first()).toHaveAttribute("data-value", /Insurance/);
    await expect(palette.getByRole("option").nth(1)).toBeVisible();
  });

  test("file palette resets scroll position when reopened", async ({ page }) => {
    await gotoWiki(page, "/");
    await page.evaluate(() => {
      localStorage.removeItem("cmd-palette-recent");
    });

    await page.getByTestId("sidebar-search").click();
    const listbox = page.locator("#page-palette-list");
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option").first()).toBeVisible();
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);

    await listbox.evaluate((element) => {
      element.scrollTop = 600;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await expect
      .poll(() => listbox.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await page.getByTestId("sidebar-search").click();

    await expect
      .poll(() => page.locator("#page-palette-list").evaluate((element) => element.scrollTop))
      .toBe(0);
    await expect(page.locator("#page-palette-list").getByRole("option").first()).toHaveAttribute(
      "data-index",
      "0",
    );
  });

  test("outline palette jumps to headings rendered from markdown", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await palette.getByRole("button", { name: /Claims follow-up/ }).click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });

  test("action palette keeps backend-owned features as backend links", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("link", { name: /Search wiki/ })).toHaveAttribute(
      "href",
      /\/search\?returnTo=%2Fwiki%2Flogistics%2Finsurance$/,
    );
    await expect(palette.getByRole("link", { name: /New chat/ })).toHaveAttribute(
      "href",
      /\/chat\?returnTo=%2Fwiki%2Flogistics%2Finsurance$/,
    );
    await expect(palette.getByRole("link", { name: /Download full wiki/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=full&scope=public$/,
    );
    await expect(palette.getByRole("link", { name: /Download markdown archive/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=markdown&scope=public$/,
    );
  });

  test("action palette includes current-page source file actions", async ({ page }) => {
    await gotoWiki(page, "/sources/people/providers/stanford/telli");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Open telli-2016-hrd-platinum-tnbc\.pdf/ }),
    ).toHaveAttribute(
      "href",
      /\/api\/file\?path=sources%2Fpeople%2Fproviders%2Fstanford%2Ftelli%2Ftelli-2016-hrd-platinum-tnbc\.pdf/,
    );
  });

  test("asset palette opens PDF and file assets through the backend file route", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await page.getByRole("button", { name: /Browse source assets/ }).click();
    await page.getByTestId("command-palette-input").fill("telli");

    await expect(
      page.getByTestId("command-palette").getByRole("link", { name: /telli-2016-hrd/ }),
    ).toHaveAttribute("href", /\/api\/file\?path=sources%2Fpeople%2Fproviders%2Fstanford/);

    await page.getByTestId("command-palette-input").fill("pathology");
    await expect(
      page.getByTestId("command-palette").getByRole("link", { name: /pathology-slide.png/ }),
    ).toHaveAttribute("href", /\/api\/file\?path=sources%2Fimages%2Fpathology-slide.png/);
  });

  test("tag palette filters the local page index without backend search", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await page.getByRole("button", { name: /Browse tags/ }).click();
    await page.getByTestId("command-palette-input").fill("logistics");
    await page.getByTestId("command-palette").getByRole("button", { name: /logistics/ }).click();

    await expect(page.getByTestId("command-palette-input")).toHaveValue("logistics");
    await expect(
      page.getByTestId("command-palette").getByRole("option", { name: /Insurance/ }),
    ).toBeVisible();
  });

  test("recent palette opens pages remembered by local navigation", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "Diana Wiki Home" }).click();
    await waitForPageTitle(page, "Diana Wiki Home");

    await page.getByTestId("sidebar-search").click();
    await expect(page.getByTestId("command-palette")).toContainText("Recent pages");
    await page.getByTestId("command-palette").getByRole("option", { name: /Insurance/ }).click();

    await expect(page).toHaveURL(/\/wiki\/logistics\/insurance$/);
    await waitForPageTitle(page, "Insurance");
  });

  test("debug palette exposes local cache tools", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance?devtools=1");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+D" : "Control+Shift+D");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Warm local markdown cache/ }),
    ).toBeVisible();
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Reset local cache/ }),
    ).toBeVisible();
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Disable LiveStore devtools/ }),
    ).toBeVisible();

    await page
      .getByTestId("command-palette")
      .getByRole("button", { name: /Warm local markdown cache/ })
      .click();
    await expect(page.getByTestId("livestore-devtools-footer")).toContainText(/Warming|Queued/);
  });
});

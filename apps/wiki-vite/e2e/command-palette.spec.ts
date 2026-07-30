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
    const aboutOption = page.getByRole("option", { name: /About/ });
    await expect(aboutOption.locator("strong")).toHaveText("About");
    await expect(aboutOption).not.toContainText("About This Wiki");
    await aboutOption.click();

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
    await expect(palette.getByRole("option", { name: /index/ }).locator("small")).toHaveText(
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
    await expect(palette.getByRole("option").first()).toHaveAttribute("data-value", /insurance/);
    await expect(palette.getByRole("option").nth(1)).toBeVisible();
  });

  test("file palette keeps muted surfaces and muted text as separate theme tokens", async ({
    page,
  }) => {
    await gotoWiki(page, "/");
    await page.evaluate(() => {
      localStorage.setItem("cmd-palette-recent", JSON.stringify(["wiki/logistics/insurance"]));
    });

    await page.getByTestId("sidebar-search").click();

    const palette = page.getByTestId("command-palette");
    const recentHeading = palette.getByText("Recent pages");
    const recentPath = palette.getByRole("option").first().locator("small");
    await expect(recentHeading).toHaveCSS("color", "rgb(107, 114, 128)");
    await expect(recentPath).toHaveCSS("color", "rgb(107, 114, 128)");
    await expect(palette.locator("footer")).toHaveCount(0);

    const themeTokens = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return {
        muted: styles.getPropertyValue("--muted").trim(),
        mutedForeground: styles.getPropertyValue("--muted-foreground").trim(),
      };
    });
    expect(themeTokens).toEqual({
      muted: "#f3f4f6",
      mutedForeground: "#6b7280",
    });

    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await expect(recentHeading).toHaveCSS("color", "rgb(156, 163, 175)");
    await expect(recentPath).toHaveCSS("color", "rgb(156, 163, 175)");
    await expect(palette.locator("footer")).toHaveCount(0);
  });

  test("file palette matches the compact centered desktop and mobile geometry", async ({
    page,
  }) => {
    await gotoWiki(page, "/");
    await page.evaluate(() => {
      localStorage.setItem("cmd-palette-recent", JSON.stringify(["wiki/logistics/insurance"]));
    });
    await page.getByTestId("sidebar-search").click();

    const desktopBox = await page.getByTestId("command-palette").boundingBox();
    const desktopListBox = await page.locator("#page-palette-list").boundingBox();
    const desktopSelectedBox = await page.getByRole("option").first().boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopListBox).not.toBeNull();
    expect(desktopSelectedBox).not.toBeNull();
    expect(desktopBox!.width).toBe(576);
    expect(desktopBox!.height).toBe(356);
    expect(Math.abs(desktopBox!.x - (page.viewportSize()!.width - desktopBox!.width) / 2))
      .toBeLessThan(1);
    expect(Math.abs(desktopBox!.y - page.viewportSize()!.height * 0.25)).toBeLessThan(1);
    expect(desktopListBox!.x - desktopBox!.x).toBe(4);
    expect(desktopListBox!.width).toBe(568);
    expect(desktopSelectedBox!.x - desktopBox!.x).toBe(12);
    expect(desktopSelectedBox!.y - desktopBox!.y).toBe(96);
    expect(desktopSelectedBox!.width).toBe(552);
    expect(
      await page.locator("#page-palette-list").evaluate((element) => ({
        clientWidth: element.clientWidth,
        offsetWidth: element.offsetWidth,
      })),
    ).toEqual({ clientWidth: 568, offsetWidth: 568 });

    await page.getByRole("combobox", { name: "Search pages" }).press("Escape");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("mobile-header-search").click();

    const mobileBox = await page.getByTestId("command-palette").boundingBox();
    const mobileListBox = await page.locator("#page-palette-list").boundingBox();
    expect(mobileBox).not.toBeNull();
    expect(mobileListBox).not.toBeNull();
    expect(mobileBox!.x).toBe(8);
    expect(mobileBox!.width).toBe(374);
    expect(Math.abs(mobileBox!.height - 574.390625)).toBeLessThan(0.1);
    expect(Math.abs(mobileBox!.y - page.viewportSize()!.height * 0.1)).toBeLessThan(1);
    expect(mobileListBox!.x).toBe(12);
    expect(mobileListBox!.width).toBe(366);
    expect(Math.abs(mobileListBox!.height - 506.390625)).toBeLessThan(0.1);

    const selectedBox = await page.getByRole("option").first().boundingBox();
    expect(selectedBox).not.toBeNull();
    expect(selectedBox!.x).toBe(20);
    expect(Math.abs(selectedBox!.y - mobileBox!.y - 96)).toBeLessThan(1);
    expect(selectedBox!.width).toBe(350);
    expect(selectedBox!.height).toBe(56);
    expect(
      await page.locator("#page-palette-list").evaluate((element) => ({
        clientWidth: element.clientWidth,
        offsetWidth: element.offsetWidth,
      })),
    ).toEqual({ clientWidth: 366, offsetWidth: 366 });
  });

  test("file palette uses production typography and neutral selection in light and dark themes", async ({
    page,
  }) => {
    await gotoWiki(page, "/");
    await page.getByTestId("sidebar-search").click();

    const palette = page.getByTestId("command-palette");
    const input = page.getByTestId("command-palette-input");
    const selected = palette.getByRole("option").first();
    await expect(input).toHaveCSS("font-size", "14px");
    await expect(selected).toHaveCSS("background-color", "rgb(243, 244, 246)");
    await expect(selected).toHaveCSS("box-shadow", "none");
    await expect(selected).toHaveCSS("min-height", "56px");
    await expect(selected.locator("strong")).toHaveCSS("font-size", "14px");
    await expect(selected.locator("strong")).toHaveCSS("font-weight", "400");
    await expect(palette).toHaveCSS("border-radius", "14px");
    await expect(page.locator(".wiki-shell-command-backdrop")).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0.1)",
    );

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await expect(selected).toHaveCSS("background-color", "rgb(45, 45, 68)");
    await expect(input).toHaveCSS("font-size", "14px");
  });

  test("Vite uses the same system font stack as the production reader", async ({ page }) => {
    await gotoWiki(page, "/");
    await expect(page.locator("html")).toHaveCSS(
      "font-family",
      "ui-sans-serif, system-ui, sans-serif",
    );
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

  test("file palette behaves as a modal and restores its trigger", async ({ page }) => {
    await gotoWiki(page, "/");

    const trigger = page.getByTestId("sidebar-search");
    await trigger.focus();
    await trigger.click();
    await expect(page.getByTestId("command-palette-input")).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("option").last()).toBeFocused();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("command-palette")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("");
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

  test("source PDF palette opens manifest PDFs through the backend file route", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await page.getByRole("button", { name: /Browse source PDFs/ }).click();
    await page.getByTestId("command-palette-input").fill("telli");

    await expect(
      page.getByTestId("command-palette").getByRole("link", { name: /telli-2016-hrd/ }),
    ).toHaveAttribute("href", /\/api\/file\?path=sources%2Fpeople%2Fproviders%2Fstanford/);

    await page.getByTestId("command-palette-input").fill("pathology");
    await expect(page.getByTestId("command-palette")).toContainText("No source PDFs found");
  });

  test("tag palette filters the local page index without backend search", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await page.getByRole("button", { name: /Browse tags/ }).click();
    await page.getByTestId("command-palette-input").fill("logistics");
    await page.getByTestId("command-palette").getByRole("button", { name: /logistics/ }).click();

    await expect(page.getByTestId("command-palette-input")).toHaveValue("logistics");
    await expect(
      page.getByTestId("command-palette").getByRole("option", { name: /insurance/i }),
    ).toBeVisible();
  });

  test("recent palette opens pages remembered by local navigation", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await page.getByTestId("wiki-sidebar").getByRole("link", { name: "index", exact: true }).click();
    await waitForPageTitle(page, "Diana Wiki Home");

    await page.getByTestId("sidebar-search").click();
    await expect(page.getByTestId("command-palette")).toContainText("Recent pages");
    await page.getByTestId("command-palette").getByRole("option", { name: /insurance/i }).click();

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

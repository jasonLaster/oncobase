import { expect, test } from "@playwright/test";
import { gotoWiki, installWikiApiMocks, waitForPageTitle } from "./fixtures";

test.describe("Command palette parity", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
  });

  test("palette trigger opens local page navigation", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("command-palette-trigger").click();
    await page.getByTestId("command-palette-input").fill("about");
    await page.getByRole("button", { name: /About This Wiki/ }).click();

    await expect(page).toHaveURL(/\/about\/About$/);
    await waitForPageTitle(page, "About This Wiki");
  });

  test("palette supports keyboard selection and tab state", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("command-palette-trigger").click();
    await page.getByTestId("command-palette-input").fill("wiki/");
    await expect(page.getByRole("button", { name: "Pages" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page).not.toHaveURL(/\/$/);
    await expect(page.getByTestId("document-article")).toBeVisible();
  });

  test("outline palette jumps to headings rendered from markdown", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O");
    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await palette.getByRole("button", { name: "Outline", exact: true }).click();
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
  });

  test("action palette includes current-page source file actions", async ({ page }) => {
    await gotoWiki(page, "/sources/institutions/stanford/telli");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Open telli-2016-hrd-platinum-tnbc\.pdf/ }),
    ).toHaveAttribute(
      "href",
      /\/api\/file\?path=sources%2Finstitutions%2Fstanford%2Ftelli%2Ftelli-2016-hrd-platinum-tnbc\.pdf/,
    );
  });

  test("asset palette opens PDF and file assets through the backend file route", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("command-palette-trigger").click();
    await page.getByRole("button", { name: "Assets" }).click();
    await page.getByTestId("command-palette-input").fill("telli");

    await expect(
      page.getByTestId("command-palette").getByRole("link", { name: /telli-2016-hrd/ }),
    ).toHaveAttribute("href", /\/api\/file\?path=sources%2Finstitutions%2Fstanford/);

    await page.getByTestId("command-palette-input").fill("pathology");
    await expect(
      page.getByTestId("command-palette").getByRole("link", { name: /pathology-slide.png/ }),
    ).toHaveAttribute("href", /\/api\/file\?path=sources%2Fimages%2Fpathology-slide.png/);
  });

  test("tag palette filters the local page index without backend search", async ({ page }) => {
    await gotoWiki(page, "/");

    await page.getByTestId("command-palette-trigger").click();
    await page.getByRole("button", { name: "Tags" }).click();
    await page.getByTestId("command-palette-input").fill("logistics");
    await page.getByTestId("command-palette").getByRole("button", { name: /logistics/ }).click();

    await expect(page.getByRole("button", { name: "Pages" })).toHaveClass(/active/);
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Insurance/ }),
    ).toBeVisible();
  });

  test("recent palette opens pages remembered by local navigation", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");
    await waitForPageTitle(page, "Insurance");
    await page.getByTestId("app-header").getByRole("link", { name: "Home" }).click();
    await waitForPageTitle(page, "Diana Wiki Home");

    await page.getByTestId("command-palette-trigger").click();
    await page.getByRole("button", { name: "Recent" }).click();
    await page.getByTestId("command-palette").getByRole("button", { name: /Insurance/ }).click();

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

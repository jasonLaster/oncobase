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

  test("outline palette jumps to headings rendered from markdown", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+O" : "Control+Shift+O");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByRole("button", { name: "Outline" }).click();
    await page
      .getByTestId("command-palette")
      .getByRole("button", { name: /Claims follow-up/ })
      .click();

    await expect(page).toHaveURL(/#claims-follow-up$/);
  });

  test("action palette keeps backend-owned features as backend links", async ({ page }) => {
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+K" : "Control+Shift+K");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(page.getByRole("link", { name: /Search wiki/ })).toHaveAttribute(
      "href",
      /\/search\?returnTo=%2Fwiki%2Flogistics%2Finsurance$/,
    );
    await expect(page.getByRole("link", { name: /New chat/ })).toHaveAttribute(
      "href",
      /\/chat\?returnTo=%2Fwiki%2Flogistics%2Finsurance$/,
    );
    await expect(page.getByRole("link", { name: /Download full wiki/ })).toHaveAttribute(
      "href",
      /\/api\/download\?type=full$/,
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
    await gotoWiki(page, "/wiki/logistics/insurance");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+D" : "Control+Shift+D");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Warm local markdown cache/ }),
    ).toBeVisible();
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Reset local cache/ }),
    ).toBeVisible();
    await expect(
      page.getByTestId("command-palette").getByRole("button", { name: /Enable LiveStore devtools/ }),
    ).toBeVisible();

    await page
      .getByTestId("command-palette")
      .getByRole("button", { name: /Warm local markdown cache/ })
      .click();
    await expect(page.getByTestId("app-header")).toContainText(/Warming|Queued/);
  });
});

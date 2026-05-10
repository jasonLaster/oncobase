import { expect, test } from "@playwright/test";
import {
  documentArticle,
  firstSmartTableShell,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";

test.describe("Smart table examples", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/examples/smart-table");
  });

  test("renders fixture headings and desktop expand toggle", async ({ page }) => {
    await expect(documentArticle(page).locator("#smart-table-examples")).toBeVisible();
    await expect(documentArticle(page).locator("#component-api-scenarios")).toBeVisible();
    await expect(documentArticle(page).locator("#resize-performance-audit")).toBeVisible();
    await expect(firstSmartTableShell(page)).toBeVisible();
    await expect(firstSmartTableToggle(page)).toBeVisible();
  });

  test("client-rendered tables ship styled markup before expansion", async ({ page }) => {
    const shell = firstSmartTableShell(page);
    await expect(shell.locator("[data-smart-table-wrapper]").first()).toBeVisible();
    await expect(shell.locator("table.smart-table").first()).toBeVisible();
    await expect
      .poll(() =>
        shell.evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--smart-table-css-loaded").trim(),
        ),
      )
      .toBe("1");
    await expect
      .poll(() =>
        shell
          .locator("table.smart-table th")
          .first()
          .evaluate((cell) => getComputedStyle(cell).textTransform),
      )
      .toBe("uppercase");

    const snapshot = await shell.locator("table.smart-table").first().evaluate((table) => {
      const th = table.querySelector("th");
      const wrapper = table.closest<HTMLElement>("[data-smart-table-wrapper]");
      return {
        tableClass: table.className,
        wrapperBorderTopWidth: wrapper ? getComputedStyle(wrapper).borderTopWidth : "0px",
        thTextTransform: th ? getComputedStyle(th).textTransform : "",
      };
    });
    expect(snapshot.tableClass).toContain("smart-table");
    expect(Number.parseFloat(snapshot.wrapperBorderTopWidth)).toBeGreaterThan(0);
    expect(snapshot.thTextTransform).toBe("uppercase");
  });
});

import { expect, test, type Page } from "@playwright/test";
import {
  documentArticle,
  firstSmartTableShell,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "../fixtures";

/** Mocked table expansion: the layout invariants the real-backend read journey does not exercise. */

async function railMetrics(page: Page) {
  return page.evaluate(() => {
    const visible = (element: HTMLElement | null) => {
      if (!element) return false;
      const r = element.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(element).display !== "none";
    };
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    const left = visible(document.querySelector<HTMLElement>("[data-sidebar-expanded-rail]"))
      ? "[data-sidebar-expanded-rail]"
      : "[data-sidebar-collapsed-rail]";
    return { layer: rect(".table-expansion-layer"), leftRail: rect(left), rightRail: rect('[data-test-id="page-outline"]') };
  });
}

async function firstTableState(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    const table =
      layer?.querySelector<HTMLTableElement>(":scope > .table-scroll-wrapper table") ??
      shell?.querySelector<HTMLTableElement>("[data-smart-table-wrapper] table") ??
      document.querySelector<HTMLTableElement>("[data-smart-table-wrapper] table");
    const cols = Array.from(table?.querySelectorAll<HTMLTableColElement>("colgroup col") ?? []).map((col) => col.style.width);
    return { locked: table?.dataset.smartTableLocked ?? null, tableWidth: table?.style.width ?? null, cols };
  });
}

async function dragFirstResizeHandle(page: Page, deltaX: number) {
  const shell = firstSmartTableShell(page);
  const handle = shell.getByLabel("Resize column 1").first();
  await handle.hover();
  const box = await handle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  if (!box.width || !box.height) throw new Error("Resize handle has no layout box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  try {
    // Prove the real pointer event engaged resizing before moving the cursor.
    await expect(shell.locator("table").first()).toHaveAttribute("data-smart-table-locked", "manual");
    await page.mouse.move(startX + deltaX, startY, { steps: 12 });
  } finally {
    await page.mouse.up();
  }
}

test.describe("prose table expansion (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/examples/smart-table");
  });

  test("an expanded table spans between the sidebar and outline rails, and falls back in-flow on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const collapsedWidth = await firstSmartTableShell(page)
      .locator("[data-smart-table-wrapper]")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);

    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();
    const initial = await railMetrics(page);
    expect(initial.layer.left).toBeGreaterThanOrEqual(initial.leftRail.right + 16);
    expect(initial.layer.right).toBeLessThanOrEqual(initial.rightRail.left - 16);
    expect(initial.layer.width).toBeGreaterThan(collapsedWidth);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(async () => (await railMetrics(page)).layer.width).toBeGreaterThan(initial.layer.width);
    const leftCollapsed = await railMetrics(page);
    expect(leftCollapsed.layer.left).toBeGreaterThanOrEqual(leftCollapsed.leftRail.right + 16);
    expect(leftCollapsed.layer.right).toBeLessThanOrEqual(leftCollapsed.rightRail.left - 16);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".table-expansion-layer")).toHaveCount(0);
    await expect(firstSmartTableShell(page).locator("[data-smart-table-wrapper]")).toBeVisible();
  });

  test("expanding and collapsing works, and a reload resets expansion without orphaned layers", async ({ page }) => {
    await firstSmartTableToggle(page).click();
    const layer = page.locator(".table-expansion-layer").first();
    await expect(layer).toBeVisible();
    await page.getByRole("button", { name: "Collapse table" }).click();
    await expect(layer).toHaveCount(0);

    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();
    await page.reload();
    await expect(documentArticle(page)).toBeVisible();
    await expect(firstSmartTableToggle(page)).toBeVisible();
    await expect(page.locator(".table-expansion-layer")).toHaveCount(0);
    expect(await firstSmartTableShell(page).evaluate((node) => Number.parseFloat(node.style.minHeight || "0"))).toBe(0);
    await expect(page.getByRole("button", { name: "Collapse table" })).toHaveCount(0);
  });

  test("manual column widths survive an outline change and expansion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.querySelector("[data-smart-table-shell]")?.scrollIntoView({ block: "center" }));
    await firstSmartTableShell(page).getByLabel("Resize column 1").first().waitFor({ state: "attached" });

    await dragFirstResizeHandle(page, 520);
    const before = await firstTableState(page);
    expect(before.locked).toBe("manual");

    await page.getByRole("button", { name: "Open outline" }).click();
    await expect(page.getByTestId("page-outline")).toHaveAttribute("data-outline-state", "expanded");
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    await expect.poll(async () => (await firstTableState(page)).locked).toBe("manual");
    const after = await firstTableState(page);
    expect(after.tableWidth).toBe(before.tableWidth);
    expect(after.cols).toEqual(before.cols);
  });
});

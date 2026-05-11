import { expect, test, type Page } from "@playwright/test";
import {
  documentArticle,
  firstSmartTableShell,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";

test.describe("Prose table expansion", () => {
  test.beforeEach(async ({ page }) => {
    await installWikiApiMocks(page);
    await gotoWiki(page, "/wiki/examples/smart-table");
  });

  test("expands and collapses the first prose table", async ({ page }) => {
    const shell = firstSmartTableShell(page);
    const collapsedWidth = await shell
      .locator("[data-smart-table-wrapper]")
      .first()
      .evaluate((element) => element.getBoundingClientRect().width);

    await firstSmartTableToggle(page).click();
    const layer = page.locator(".table-expansion-layer").first();
    await expect(layer).toBeVisible();
    const expandedWidth = await layer.evaluate((element) => element.getBoundingClientRect().width);
    expect(expandedWidth).toBeGreaterThan(collapsedWidth);

    await page.getByRole("button", { name: "Collapse table" }).click();
    await expect(layer).toHaveCount(0);
  });

  test("keeps the expanded table between the sidebar and outline rails", async ({ page }) => {
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
    await expect
      .poll(async () => (await railMetrics(page)).layer.width)
      .toBeGreaterThan(initial.layer.width);

    const leftCollapsed = await railMetrics(page);
    expect(leftCollapsed.layer.left).toBeGreaterThanOrEqual(leftCollapsed.leftRail.right + 16);
    expect(leftCollapsed.layer.right).toBeLessThanOrEqual(leftCollapsed.rightRail.left - 16);

    await page.getByRole("button", { name: "Open outline" }).click();
    await expect(page.getByTestId("page-outline")).toHaveAttribute(
      "data-outline-state",
      "expanded",
    );
    const rightExpanded = await railMetrics(page);
    expect(rightExpanded.layer.right).toBeLessThanOrEqual(rightExpanded.rightRail.left - 16);
    expect(rightExpanded.layer.width).toBeLessThan(leftCollapsed.layer.width);

    await page.getByRole("button", { name: "Collapse outline pane" }).click();
    await expect
      .poll(async () => (await railMetrics(page)).layer.width)
      .toBeGreaterThan(rightExpanded.layer.width);
  });

  test("preserves table styling when expanded", async ({ page }) => {
    await expect
      .poll(() =>
        firstSmartTableShell(page)
          .locator("table.smart-table th")
          .first()
          .evaluate((cell) => getComputedStyle(cell).textTransform),
      )
      .toBe("uppercase");
    const before = "uppercase";

    await firstSmartTableToggle(page).click();
    const after = await page
      .locator(".table-expansion-layer table.smart-table th")
      .first()
      .evaluate((cell) => getComputedStyle(cell).textTransform);

    expect(after).toBe(before);
  });

  test("falls back to the in-flow table when resized to mobile while expanded", async ({ page }) => {
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });

    await expect(page.locator(".table-expansion-layer")).toHaveCount(0);
    await expect(firstSmartTableShell(page).locator("[data-smart-table-wrapper]")).toBeVisible();
  });

  test("serves the table examples route in the real Vite app", async ({ page }) => {
    await gotoWiki(page, "/table-examples");

    await expect(documentArticle(page).locator(".page-header h1")).toHaveText("Table Examples");
    await expect(firstSmartTableShell(page)).toBeVisible();
    await expect(firstSmartTableToggle(page)).toBeVisible();
  });

  test("tracks the real vertical scroll container while expanded", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();
    await resetScrollOwner(page);
    await page.waitForTimeout(300);

    const before = await tableMetrics(page);
    const startScroll = before.scrollOwner?.scrollTop ?? 0;

    await scrollFirstTableContainer(page, 260);

    const after = await tableMetrics(page);
    const scrolled = (after.scrollOwner?.scrollTop ?? 0) - startScroll;
    expect(scrolled).toBeGreaterThan(200);

    const layerDelta = (before.layer?.top ?? 0) - (after.layer?.top ?? 0);
    const shellDelta = (before.shell?.top ?? 0) - (after.shell?.top ?? 0);
    expect(layerDelta).toBeGreaterThan(150);
    expect(shellDelta).toBeGreaterThan(150);
    expect(Math.abs(layerDelta - shellDelta)).toBeLessThan(4);
  });

  test("wheel scrolling over the expanded table moves the underlying page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();
    await resetScrollOwner(page);
    await page.waitForTimeout(300);

    const before = await tableMetrics(page);
    const startScroll = before.scrollOwner?.scrollTop ?? 0;

    const wrapper = page.locator("[data-smart-table-wrapper]").first();
    await wrapper.hover();
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(200);

    const after = await tableMetrics(page);
    expect((after.scrollOwner?.scrollTop ?? 0) - startScroll).toBeGreaterThan(200);
    expect(Math.abs((after.layer?.top ?? 0) - (before.layer?.top ?? 0))).toBeGreaterThan(150);
  });

  test("keeps the overflow fade pinned to the physical right edge", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    const fade = await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
      const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
      const wrapper =
        layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
        shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
        document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
      const table = wrapper?.querySelector<HTMLTableElement>("table");
      if (!layer || !wrapper || !table) return null;

      table.style.minWidth = `${wrapper.clientWidth + 400}px`;
      table.style.width = `${wrapper.clientWidth + 400}px`;
      table.dispatchEvent(new CustomEvent("smart-table:layout-change"));
      wrapper.scrollLeft = 1;
      wrapper.dispatchEvent(new Event("scroll"));

      const fadeNode =
        layer.querySelector<HTMLElement>(".smart-table-overflow-fade") ??
        wrapper.querySelector<HTMLElement>(".smart-table-overflow-fade");
      if (!fadeNode) return null;

      const fadeRect = fadeNode.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      return {
        offsetFromLayerRight: Math.abs(layerRect.right - fadeRect.right),
        width: fadeRect.width,
      };
    });

    expect(fade).not.toBeNull();
    expect(fade?.offsetFromLayerRight ?? 999).toBeLessThanOrEqual(1);
    expect(fade?.width ?? 0).toBeGreaterThan(0);
  });

  test("manual column resize widens the collapsed table", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await scrollFirstSmartTableIntoView(page);

    const handle = firstSmartTableShell(page).getByLabel("Resize column 1").first();
    await handle.waitFor({ state: "attached" });

    const initial = await handle.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { opacity: style.opacity, backgroundImage: style.backgroundImage };
    });

    expect(Number.parseFloat(initial.opacity || "0")).toBe(0);
    expect(initial.backgroundImage === "none" || initial.backgroundImage === "").toBeTruthy();

    await dragFirstResizeHandle(page, 520);

    const metrics = await tableMetrics(page);
    expect(metrics.wrapper).not.toBeNull();
    expect(
      (metrics.wrapper?.scrollWidth ?? 0) - (metrics.wrapper?.clientWidth ?? 0),
    ).toBeGreaterThan(40);

    const tableState = await page.evaluate(() => {
      const table = document.querySelector<HTMLTableElement>("[data-smart-table-wrapper] table");
      return {
        locked: table?.dataset.smartTableLocked,
        width: table?.style.width ?? "",
      };
    });

    expect(tableState.locked).toBe("manual");
    expect(tableState.width).not.toBe("");
  });

  test("manual widths survive sidebar changes and expansion", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await scrollFirstSmartTableIntoView(page);
    await firstSmartTableShell(page)
      .getByLabel("Resize column 1")
      .first()
      .waitFor({ state: "attached" });

    await dragFirstResizeHandle(page, 520);
    const before = await firstTableState(page);
    expect(before.locked).toBe("manual");

    await page.getByRole("button", { name: "Open outline" }).click();
    await expect(page.getByTestId("page-outline")).toHaveAttribute(
      "data-outline-state",
      "expanded",
    );
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    await expect.poll(async () => (await firstTableState(page)).locked).toBe("manual");
    const after = await firstTableState(page);
    expect(after.tableWidth).toBe(before.tableWidth);
    expect(after.cols).toEqual(before.cols);
  });

  test("expanded wrapper keeps horizontal scrolling when content exceeds the lane", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Open outline" }).click();
    await expect(page.getByTestId("page-outline")).toHaveAttribute(
      "data-outline-state",
      "expanded",
    );
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    const horizontal = await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
      const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
      const wrapper =
        layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
        shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
        document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
      const table = wrapper?.querySelector<HTMLTableElement>("table");
      if (!wrapper || !table) return null;

      table.style.minWidth = `${wrapper.clientWidth + 400}px`;
      table.style.width = `${wrapper.clientWidth + 400}px`;

      const before = wrapper.scrollLeft;
      wrapper.scrollLeft = 180;

      return {
        before,
        after: wrapper.scrollLeft,
        max: wrapper.scrollWidth - wrapper.clientWidth,
        tableWidth: table.getBoundingClientRect().width,
        wrapperWidth: wrapper.getBoundingClientRect().width,
      };
    });

    expect(horizontal).not.toBeNull();
    expect(horizontal?.max ?? 0).toBeGreaterThan(40);
    expect(horizontal?.after ?? 0).toBeGreaterThan(horizontal?.before ?? 0);
    expect(horizontal?.tableWidth ?? 0).toBeGreaterThan(horizontal?.wrapperWidth ?? 0);
  });

  test("reload resets expansion without leaving orphaned layers", async ({ page }) => {
    await firstSmartTableToggle(page).click();
    await expect(page.locator(".table-expansion-layer")).toBeVisible();

    await page.reload();
    await expect(documentArticle(page)).toBeVisible();
    await expect(firstSmartTableToggle(page)).toBeVisible();

    await expect(page.locator(".table-expansion-layer")).toHaveCount(0);
    const shellReserved = await firstSmartTableShell(page).evaluate(
      (node) => Number.parseFloat(node.style.minHeight || "0"),
    );
    expect(shellReserved).toBe(0);

    const visibleCollapseCount = await page.evaluate(
      () =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[aria-label="Collapse table"]'),
        ).filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
    );
    expect(visibleCollapseCount).toBe(0);
  });
});

async function tableMetrics(page: Page) {
  return page.evaluate(() => {
    const getVerticalScrollContainer = (node: HTMLElement) => {
      let current: HTMLElement | null = node.parentElement;
      while (current) {
        const { overflowY } = window.getComputedStyle(current);
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          current.scrollHeight > current.clientHeight
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : document.documentElement;
    };

    const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    const wrapper =
      layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
      shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
      document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
    const scrollOwner = shell ? getVerticalScrollContainer(shell) : null;
    const rect = (node: Element | null) => {
      if (!(node instanceof HTMLElement)) return null;
      const box = node.getBoundingClientRect();
      return { top: box.top, left: box.left, right: box.right, width: box.width, height: box.height };
    };

    return {
      shell: rect(shell),
      layer: rect(layer),
      wrapper:
        wrapper instanceof HTMLElement
          ? {
              ...rect(wrapper),
              scrollWidth: wrapper.scrollWidth,
              clientWidth: wrapper.clientWidth,
              scrollLeft: wrapper.scrollLeft,
            }
          : null,
      scrollOwner:
        scrollOwner instanceof HTMLElement
          ? {
              tagName: scrollOwner.tagName,
              className: scrollOwner.className,
              scrollTop: scrollOwner.scrollTop,
              scrollHeight: scrollOwner.scrollHeight,
              clientHeight: scrollOwner.clientHeight,
            }
          : null,
    };
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

    const cols = Array.from(
      table?.querySelectorAll<HTMLTableColElement>("colgroup col") ?? [],
    ).map((col) => col.style.width);

    return {
      locked: table?.dataset.smartTableLocked ?? null,
      tableWidth: table?.style.width ?? null,
      cols,
    };
  });
}

async function resetScrollOwner(page: Page) {
  await page.evaluate(() => {
    const getVerticalScrollContainer = (node: HTMLElement) => {
      let current: HTMLElement | null = node.parentElement;
      while (current) {
        const { overflowY } = window.getComputedStyle(current);
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          current.scrollHeight > current.clientHeight
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : document.documentElement;
    };
    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    const scrollOwner = shell ? getVerticalScrollContainer(shell) : null;
    if (scrollOwner instanceof HTMLElement) {
      scrollOwner.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
}

async function scrollFirstTableContainer(page: Page, delta: number) {
  await page.evaluate((scrollDelta) => {
    const getVerticalScrollContainer = (node: HTMLElement) => {
      let current: HTMLElement | null = node.parentElement;
      while (current) {
        const { overflowY } = window.getComputedStyle(current);
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          current.scrollHeight > current.clientHeight
        ) {
          return current;
        }
        current = current.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : document.documentElement;
    };

    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    const scrollOwner = shell ? getVerticalScrollContainer(shell) : null;
    if (scrollOwner instanceof HTMLElement) {
      scrollOwner.scrollTop += scrollDelta;
    }
  }, delta);

  await page.waitForTimeout(200);
}

async function scrollFirstSmartTableIntoView(page: Page) {
  await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    shell?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(200);
}

async function dragFirstResizeHandle(page: Page, deltaX: number) {
  const handle = page.getByLabel("Resize column 1").first();
  await handle.waitFor({ state: "attached" });
  const box = await handle.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  if (!box.width || !box.height) throw new Error("Resize handle has no layout box");

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 12 });
  await page.mouse.up();
}

async function railMetrics(page: Page) {
  return await page.evaluate(() => {
    const isVisible = (element: HTMLElement | null) => {
      if (!element) return false;
      const r = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return r.width > 0 && r.height > 0 && style.display !== "none";
    };
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const r = element.getBoundingClientRect();
      return {
        left: r.left,
        right: r.right,
        width: r.width,
      };
    };

    const leftRail =
      isVisible(document.querySelector<HTMLElement>("[data-sidebar-expanded-rail]"))
        ? "[data-sidebar-expanded-rail]"
        : "[data-sidebar-collapsed-rail]";

    return {
      layer: rect(".table-expansion-layer"),
      leftRail: rect(leftRail),
      rightRail: rect('[data-test-id="page-outline"]'),
    };
  });
}

import { expect, test, type Page } from "@playwright/test";

const TABLE_PAGE = "/wiki/research/ai-models-overview";

test.describe("Prose table expansion", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TABLE_PAGE);
    await expect(
      page.getByRole("heading", { name: "AI Models & Computational Tools Overview" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Expand table" }).first()
    ).toBeVisible();
  });

  test("expands and collapses the first prose table", async ({ page }) => {
    const toggle = page.getByRole("button", { name: "Expand table" }).first();
    const collapsed = await getFirstTableMetrics(page);

    await toggle.click();

    await expect
      .poll(() => getFirstTableMetrics(page))
      .toMatchObject({
        expanded: true,
      });

    const expanded = await getFirstTableMetrics(page);
    expect(expanded.layer?.width ?? 0).toBeGreaterThan(collapsed.wrapper?.width ?? 0);
    expect(expanded.shell).not.toBeNull();
    expect(expanded.wrapper).not.toBeNull();
    expect(Math.abs((expanded.wrapper?.width ?? 0) - (expanded.layer?.width ?? 0))).toBeLessThan(4);
    expect(expanded.shellReservedHeight ?? 0).toBeGreaterThan(0);
    expect(Math.abs((expanded.shellReservedHeight ?? 0) - (expanded.shell?.height ?? 0))).toBeLessThan(4);
    expect((expanded.button?.right ?? 0) - (collapsed.button?.right ?? 0)).toBeGreaterThan(80);
    expect(Math.abs((expanded.button?.right ?? 0) - (expanded.layer?.right ?? 0))).toBeLessThan(24);

    await page.getByRole("button", { name: "Collapse table" }).first().click();

    await expect
      .poll(() => getFirstTableMetrics(page))
      .toMatchObject({
        expanded: false,
      });
  });

  test("updates the expanded lane when the sidebars change", async ({ page }) => {
    await page.getByRole("button", { name: "Expand table" }).first().click();

    const initial = await getFirstTableMetrics(page);
    expect(initial.expanded).toBe(true);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();

    await expect
      .poll(async () => (await getFirstTableMetrics(page)).layer?.width ?? 0)
      .toBeGreaterThan(initial.layer?.width ?? 0);

    const widened = await getFirstTableMetrics(page);
    expect((widened.leftRail?.width ?? 999)).toBeLessThan(initial.leftRail?.width ?? 0);

    await toggleRightRail(page, "open");

    await expect
      .poll(async () => (await getFirstTableMetrics(page)).layer?.width ?? 0)
      .toBeLessThan(widened.layer?.width ?? Number.MAX_SAFE_INTEGER);

    const narrowed = await getFirstTableMetrics(page);

    await toggleRightRail(page, "close");

    await expect
      .poll(async () => (await getFirstTableMetrics(page)).layer?.width ?? 0)
      .toBeGreaterThan(narrowed.layer?.width ?? 0);
  });

  test("tracks the real vertical scroll container while expanded", async ({ page }) => {
    await page.getByRole("button", { name: "Expand table" }).first().click();

    const before = await getFirstTableMetrics(page);
    expect(before.expanded).toBe(true);
    expect(before.scrollOwner?.scrollTop ?? 0).toBe(0);

    const afterScroll = await scrollFirstTableIntoFlow(page, 260);

    expect(afterScroll.scrollOwner?.scrollTop ?? 0).toBeGreaterThan(200);
    expect(Math.abs((afterScroll.layer?.top ?? 0) - (before.layer?.top ?? 0))).toBeGreaterThan(150);

    const deltaBefore = (before.layer?.top ?? 0) - (before.shell?.top ?? 0);
    const deltaAfter = (afterScroll.layer?.top ?? 0) - (afterScroll.shell?.top ?? 0);
    expect(Math.abs(deltaAfter - deltaBefore)).toBeLessThan(3);
  });

  test("wheel scrolling over the expanded table moves the underlying page", async ({ page }) => {
    await page.getByRole("button", { name: "Expand table" }).first().click();

    const before = await getFirstTableMetrics(page);
    expect(before.scrollOwner?.scrollTop ?? 0).toBe(0);

    const wrapper = page.locator("[data-smart-table-wrapper]").first();
    await wrapper.hover();
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(200);

    const after = await getFirstTableMetrics(page);
    expect(after.scrollOwner?.scrollTop ?? 0).toBeGreaterThan(200);
    expect(Math.abs((after.layer?.top ?? 0) - (before.layer?.top ?? 0))).toBeGreaterThan(150);
  });

  test("preserves table styling when expanded", async ({ page }) => {
    const before = await getFirstTableStyleSnapshot(page);

    await page.getByRole("button", { name: "Expand table" }).first().click();

    await expect
      .poll(() => getFirstTableMetrics(page))
      .toMatchObject({
        expanded: true,
      });

    const after = await getFirstTableStyleSnapshot(page);

    expect(after.wrapper?.backgroundImage).toBe(before.wrapper?.backgroundImage);
    expect(after.wrapper?.borderTopWidth).toBe(before.wrapper?.borderTopWidth);
    expect(after.wrapper?.borderRadius).toBe(before.wrapper?.borderRadius);
    expect(after.wrapper?.paddingRight).toBe(before.wrapper?.paddingRight);
    expect(after.th?.backgroundColor).toBe(before.th?.backgroundColor);
    expect(after.th?.paddingTop).toBe(before.th?.paddingTop);
    expect(after.th?.paddingRight).toBe(before.th?.paddingRight);
    expect(after.th?.textTransform).toBe(before.th?.textTransform);
    expect(after.th?.letterSpacing).toBe(before.th?.letterSpacing);
    expect(after.td?.paddingTop).toBe(before.td?.paddingTop);
    expect(after.td?.paddingRight).toBe(before.td?.paddingRight);
    expect(after.td?.borderBottomWidth).toBe(before.td?.borderBottomWidth);
  });

  test("keeps the overflow fade pinned to the physical right edge", async ({ page }) => {
    await page.getByRole("button", { name: "Expand table" }).first().click();

    const fade = await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
      const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
      const wrapper =
        layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
        shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
        document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
      const table = wrapper?.querySelector<HTMLTableElement>("table");

      if (!wrapper || !table) {
        return null;
      }

      table.style.minWidth = `${wrapper.clientWidth + 400}px`;
      table.style.width = `${wrapper.clientWidth + 400}px`;
      wrapper.setAttribute("data-scrollable", "");
      wrapper.removeAttribute("data-scrolled-end");

      const style = window.getComputedStyle(wrapper, "::after");
      return {
        right: style.right,
        left: style.left,
        width: style.width,
      };
    });

    expect(fade).not.toBeNull();
    expect(fade?.right).toBe("0px");
    expect(Number.parseFloat(fade?.width ?? "0")).toBeGreaterThan(0);
  });

  test("falls back to the in-flow table when resized to mobile while expanded", async ({ page }) => {
    await page.getByRole("button", { name: "Expand table" }).first().click();

    await expect
      .poll(() => getFirstTableMetrics(page))
      .toMatchObject({
        expanded: true,
      });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);

    const state = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
      const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
      const wrapper = document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
      const toggles = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[aria-label="Collapse table"], [aria-label="Expand table"]'
        )
      );
      const visibleToggleCount = toggles.filter((toggle) => {
        const style = window.getComputedStyle(toggle);
        const rect = toggle.getBoundingClientRect();
        return style.display !== "none" && rect.width > 0 && rect.height > 0;
      }).length;

      const rect = (node: HTMLElement | null) =>
        node
          ? {
              top: node.getBoundingClientRect().top,
              left: node.getBoundingClientRect().left,
              width: node.getBoundingClientRect().width,
              height: node.getBoundingClientRect().height,
            }
          : null;

      return {
        hasLayer: Boolean(layer),
        wrapperParentIsShell: wrapper?.parentElement === shell,
        shell: rect(shell),
        wrapper: rect(wrapper),
        viewportWidth: window.innerWidth,
        visibleToggleCount,
      };
    });

    expect(state.hasLayer).toBe(false);
    expect(state.wrapperParentIsShell).toBe(true);
    expect(state.visibleToggleCount).toBe(0);
    expect(state.wrapper?.width ?? 0).toBeLessThanOrEqual((state.viewportWidth ?? 0) + 1);
    expect((state.wrapper?.top ?? 0) - (state.shell?.top ?? 0)).toBeGreaterThanOrEqual(0);
  });

  test("manual column resize widens the collapsed table", async ({ page }) => {
    await dragFirstResizeHandle(page, 520);

    const metrics = await getFirstTableMetrics(page);
    expect(metrics.wrapper).not.toBeNull();
    expect((metrics.wrapper?.scrollWidth ?? 0) - (metrics.wrapper?.clientWidth ?? 0)).toBeGreaterThan(40);

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
    await dragFirstResizeHandle(page, 520);

    const before = await getPrimaryTableState(page);

    await toggleRightRail(page, "open");
    await page.getByRole("button", { name: "Expand table" }).first().click();

    expect(before.locked).toBe("manual");
    await expect
      .poll(async () => (await getPrimaryTableState(page)).locked)
      .toBe("manual");

    const after = await getPrimaryTableState(page);

    expect(after.tableWidth).toBe(before.tableWidth);
    expect(after.cols).toEqual(before.cols);
  });

  test("expanded wrapper keeps horizontal scrolling when content exceeds the lane", async ({ page }) => {
    await toggleRightRail(page, "open");
    await page.getByRole("button", { name: "Expand table" }).first().click();

    const horizontal = await page.evaluate(() => {
      const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
      const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
      const wrapper =
        layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
        shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
        document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
      const table = wrapper?.querySelector<HTMLTableElement>("table");
      if (!wrapper || !table) {
        return null;
      }

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
    await page.getByRole("button", { name: "Expand table" }).first().click();

    await expect
      .poll(() => getFirstTableMetrics(page))
      .toMatchObject({
        expanded: true,
      });

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "AI Models & Computational Tools Overview" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Expand table" }).first()
    ).toBeVisible();

    await expect
      .poll(() => getFirstTableMetrics(page))
      .toMatchObject({
        expanded: false,
      });

    const metrics = await getFirstTableMetrics(page);
    expect(metrics.layer).toBeNull();
    expect(metrics.shellReservedHeight ?? 0).toBe(0);
    const visibleCollapseCount = await page.evaluate(
      () =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[aria-label="Collapse table"]')
        ).filter((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length
    );
    expect(visibleCollapseCount).toBe(0);
  });
});

async function getFirstTableMetrics(page: Page) {
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
    const leftCollapsedButton = document.querySelector<HTMLElement>('[aria-label="Expand sidebar"]');
    const leftExpandedButton = document.querySelector<HTMLElement>('[aria-label="Collapse sidebar"]');
    const leftRail =
      leftCollapsedButton?.parentElement instanceof HTMLElement
        ? leftCollapsedButton.parentElement
        : leftExpandedButton?.parentElement instanceof HTMLElement
          ? leftExpandedButton.parentElement
          : null;
    const rightRail = document.querySelector<HTMLElement>("aside.hidden.lg\\:flex.fixed.right-0");
    const scrollOwner = shell ? getVerticalScrollContainer(shell) : null;
    const button =
      layer?.querySelector<HTMLElement>(":scope > button") ??
      shell?.querySelector<HTMLElement>(
        ':scope > [aria-label="Collapse table"], :scope > [aria-label="Expand table"]'
      ) ??
      document.querySelector<HTMLElement>('[aria-label="Collapse table"], [aria-label="Expand table"]');

    const rect = (node: Element | null) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      const box = node.getBoundingClientRect();
      return {
        top: box.top,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
      };
    };

    return {
      expanded: Boolean(layer),
      shell: rect(shell),
      wrapper:
        wrapper instanceof HTMLElement
          ? {
              ...rect(wrapper),
              scrollWidth: wrapper.scrollWidth,
              clientWidth: wrapper.clientWidth,
              scrollLeft: wrapper.scrollLeft,
            }
          : null,
      layer: rect(layer),
      button: rect(button),
      leftRail: rect(leftRail),
      rightRail: rect(rightRail),
      scrollOwner:
        scrollOwner instanceof HTMLElement
          ? {
              tagName: scrollOwner.tagName,
              className: scrollOwner.className,
              scrollTop: scrollOwner.scrollTop,
              clientHeight: scrollOwner.clientHeight,
              scrollHeight: scrollOwner.scrollHeight,
            }
          : null,
      shellReservedHeight: shell
        ? Number.parseFloat(shell.style.minHeight || "0")
        : 0,
    };
  });
}

async function getPrimaryTableState(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    const table =
      layer?.querySelector<HTMLTableElement>(":scope > .table-scroll-wrapper table") ??
      shell?.querySelector<HTMLTableElement>("[data-smart-table-wrapper] table") ??
      document.querySelector<HTMLTableElement>("[data-smart-table-wrapper] table");

    const cols = Array.from(
      table?.querySelectorAll<HTMLTableColElement>("colgroup col") ?? []
    ).map((col) => col.style.width);

    return {
      locked: table?.dataset.smartTableLocked ?? null,
      tableWidth: table?.style.width ?? null,
      cols,
    };
  });
}

async function getFirstTableStyleSnapshot(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
    const shell = document.querySelector<HTMLElement>("[data-smart-table-shell]");
    const wrapper =
      layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
      shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
      document.querySelector<HTMLElement>("[data-smart-table-wrapper]");
    const table = wrapper?.querySelector<HTMLTableElement>("table");
    const th = table?.querySelector<HTMLTableCellElement>("thead th");
    const td = table?.querySelector<HTMLTableCellElement>("tbody td");

    const pick = (node: HTMLElement | null | undefined) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      const style = window.getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backgroundColor: style.backgroundColor,
        borderTopWidth: style.borderTopWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderRadius: style.borderRadius,
        paddingTop: style.paddingTop,
        paddingRight: style.paddingRight,
        textTransform: style.textTransform,
        letterSpacing: style.letterSpacing,
      };
    };

    return {
      wrapper: pick(wrapper),
      th: pick(th),
      td: pick(td),
    };
  });
}

async function scrollFirstTableIntoFlow(page: Page, delta: number) {
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
    if (!(scrollOwner instanceof HTMLElement)) {
      return;
    }

    scrollOwner.scrollTop += scrollDelta;
  }, delta);

  await page.waitForTimeout(200);
  return getFirstTableMetrics(page);
}

async function dragFirstResizeHandle(page: Page, deltaX: number) {
  const handle = page.getByLabel("Resize column 1").first();
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();

  if (!box) {
    throw new Error("Resize handle bounding box unavailable");
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY, { steps: 12 });
  await page.mouse.up();
}

async function toggleRightRail(page: Page, mode: "open" | "close") {
  await page.evaluate((nextMode) => {
    const selector =
      nextMode === "open"
        ? 'button[aria-label="Open outline"]'
        : 'button[aria-label="Collapse outline pane"]';
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>(selector)
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    button?.click();
  }, mode);

  await page.waitForTimeout(400);
}

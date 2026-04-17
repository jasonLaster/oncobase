import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  exampleTables,
  type ExampleTableDefinition,
} from "@diana-tnbc/smart-table/examples";

const TABLE_PAGE = "/table-examples";

test.describe("Smart table examples", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TABLE_PAGE);
    await expect(
      page.getByRole("heading", { name: "Smart Table Examples" })
    ).toBeVisible();
  });

  test("renders every fixture heading and desktop expand toggle", async ({
    page,
  }) => {
    for (const example of exampleTables) {
      const shell = exampleShell(page, example);
      await expect(
        page.getByRole("heading", { name: example.title, level: 2 })
      ).toBeVisible();
      await expect(shell).toBeVisible();
      await expect(exampleToggle(shell)).toBeVisible();
    }
  });

  for (const example of exampleTables) {
    test(`expands and collapses ${example.id}`, async ({ page }) => {
      const shell = exampleShell(page, example);
      const toggle = exampleToggle(shell);
      const collapsed = await exampleGeometry(page, example);

      await toggle.click();
      await expect
        .poll(() => exampleGeometry(page, example))
        .toMatchObject({ expanded: true });

      const expanded = await exampleGeometry(page, example);
      expect(expanded.layerWidth ?? 0).toBeGreaterThan(
        collapsed.wrapperWidth ?? 0
      );
      expect(expanded.shellReservedHeight ?? 0).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Collapse table" }).click();
      await expect
        .poll(() => exampleGeometry(page, example))
        .toMatchObject({ expanded: false });
    });
  }

  test("keeps the landscape fixture scrollable when widened before and after expansion", async ({
    page,
  }) => {
    const example = exampleTables.find(
      (entry) => entry.id === "overflow-landscape"
    );
    if (!example) {
      throw new Error("overflow-landscape fixture missing");
    }

    const shell = exampleShell(page, example);
    const collapsedWrapper = shell.locator("[data-smart-table-wrapper]");
    const collapsedTable = shell.locator("table");

    await collapsedTable.evaluate((node) => {
      const wrapper = node.parentElement;
      if (!wrapper) {
        return;
      }

      const width = wrapper.clientWidth + 320;
      node.style.minWidth = `${width}px`;
      node.style.width = `${width}px`;
    });

    const collapsed = await collapsedWrapper.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(collapsed.scrollWidth).toBeGreaterThan(collapsed.clientWidth + 40);

    await exampleToggle(shell).click();
    await expect
      .poll(() => exampleGeometry(page, example))
      .toMatchObject({ expanded: true });

    const expandedWrapper = page.locator(
      ".table-expansion-layer > .table-scroll-wrapper"
    );
    const expanded = await expandedWrapper.evaluate((node) => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      layerWidth: node.parentElement?.getBoundingClientRect().width ?? null,
    }));
    expect(expanded.scrollWidth).toBeGreaterThan(expanded.clientWidth + 40);
    expect(expanded.layerWidth ?? 0).toBeGreaterThan(expanded.clientWidth);
  });
});

function exampleShell(page: Page, example: ExampleTableDefinition) {
  return page
    .getByRole("heading", { name: example.title, level: 2 })
    .locator('xpath=following-sibling::div[@data-smart-table-shell][1]');
}

function exampleToggle(shell: Locator) {
  return shell.getByRole("button", { name: "Expand table" });
}

async function exampleExpandedState(
  page: Page,
  example: ExampleTableDefinition
) {
  return exampleGeometry(page, example);
}

async function exampleGeometry(page: Page, example: ExampleTableDefinition) {
  return page.evaluate((exampleId) => {
    const heading = Array.from(document.querySelectorAll("h2")).find((node) =>
      node.textContent?.includes(exampleId)
    );
    let fallbackShell: HTMLElement | null = null;
    let current = heading?.nextElementSibling ?? null;

    while (current) {
      if (current instanceof HTMLElement && current.hasAttribute("data-smart-table-shell")) {
        fallbackShell = current;
        break;
      }
      current = current.nextElementSibling;
    }

    const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
    const wrapper =
      layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
      fallbackShell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
      null;

    return {
      expanded:
        Boolean(layer) &&
        wrapper?.parentElement === layer &&
        document.body.contains(layer),
      wrapperWidth: wrapper?.getBoundingClientRect().width ?? null,
      layerWidth: layer?.getBoundingClientRect().width ?? null,
      shellWidth: fallbackShell?.getBoundingClientRect().width ?? null,
      shellReservedHeight: fallbackShell
        ? Number.parseFloat(fallbackShell.style.minHeight || "0")
        : 0,
    };
  }, example.title);
}

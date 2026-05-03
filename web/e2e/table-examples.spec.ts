import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import {
  exampleTables,
  type ExampleTableDefinition,
  featuredExampleTables,
  resizeAuditExampleTables,
} from "@diana-tnbc/smart-table/examples";

const TABLE_PAGE = "/table-examples";
const AUTH_STATE_PATH = "e2e/.auth/state.json";

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
    await expect(page.getByRole("heading", { name: "Component API Scenarios" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resize Performance Audit" })).toBeVisible();
    await expect(declarativeToggle(page)).toBeVisible();

    const liveScenarios = featuredExampleTables.filter((example) =>
      example.apiModes.includes("declarative")
    );
    const uniqueScenarioIds = await page.evaluate(() =>
      Array.from(
        new Set(
          Array.from(
            document.querySelectorAll("[data-smart-table-live-scenarios] [data-smart-table-scenario]")
          ).map((node) => node.getAttribute("data-smart-table-scenario"))
        )
      ).filter(Boolean)
    );
    expect(uniqueScenarioIds).toHaveLength(liveScenarios.length);
    const uniqueAuditTargets = await page.evaluate(() =>
      Array.from(
        new Set(
          Array.from(
            document.querySelectorAll("[data-smart-table-performance-summary] a")
          ).map((node) => node.getAttribute("href"))
        )
      ).filter(Boolean)
    );
    expect(uniqueAuditTargets).toHaveLength(resizeAuditExampleTables.length);

    for (const example of exampleTables) {
      const shell = exampleShell(page, example);
      await expect(
        page.getByRole("heading", { name: example.title, level: 2 })
      ).toBeVisible();
      await expect(shell).toBeVisible();
      await expect(exampleToggle(shell)).toBeVisible();
    }
  });

  test("server-rendered tables ship styled markup before client enhancement", async ({
    browser,
    baseURL,
  }) => {
    await verifyServerRenderedTableStyling(browser, baseURL ?? "http://localhost:3000");
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

  test("keeps the declarative SmartTable API aligned with overlay behavior", async ({
    page,
  }) => {
    await declarativeToggle(page).click();
    await expect
      .poll(() => declarativeGeometry(page))
      .toMatchObject({ expanded: true });

    await page.setViewportSize({ width: 900, height: 900 });
    await expect
      .poll(() => declarativeGeometry(page))
      .toMatchObject({ expanded: false });
    await expect(declarativeToggle(page)).toBeHidden();
  });

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
    expect(expanded.layerWidth ?? 0).toBeGreaterThanOrEqual(
      expanded.clientWidth
    );
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

function declarativeShell(page: Page) {
  return page
    .locator("[data-smart-table-live-scenarios] [data-smart-table-scenario] [data-smart-table-shell]")
    .first();
}

function declarativeToggle(page: Page) {
  return declarativeShell(page).getByRole("button", { name: "Expand table" });
}

async function declarativeGeometry(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector<HTMLElement>(
      "[data-smart-table-live-scenarios] [data-smart-table-scenario]"
    );
    const shell = section?.querySelector<HTMLElement>("[data-smart-table-shell]");
    const layer = document.querySelector<HTMLElement>(".table-expansion-layer");
    const wrapper =
      layer?.querySelector<HTMLElement>(":scope > .table-scroll-wrapper") ??
      shell?.querySelector<HTMLElement>("[data-smart-table-wrapper]") ??
      null;

    return {
      expanded:
        Boolean(layer) &&
        wrapper?.parentElement === layer &&
        document.body.contains(layer),
      wrapperWidth: wrapper?.getBoundingClientRect().width ?? null,
      layerWidth: layer?.getBoundingClientRect().width ?? null,
    };
  });
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

async function verifyServerRenderedTableStyling(browser: Browser, baseURL: string) {
  const context = await browser.newContext({
    storageState: AUTH_STATE_PATH,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${baseURL}${TABLE_PAGE}`);
    await expect(
      page.getByRole("heading", { name: "Smart Table Examples" })
    ).toBeVisible();

    const shell = page.locator("[data-smart-table-shell]").first();
    await expect(shell).toBeVisible();
    await expect(shell.locator("[data-smart-table-wrapper]").first()).toBeVisible();
    await expect(shell.locator("table.smart-table").first()).toBeVisible();

    const snapshot = await shell.evaluate((node) => {
      const wrapper = node.querySelector<HTMLElement>("[data-smart-table-wrapper]");
      const th = node.querySelector<HTMLElement>("th");
      const td = node.querySelector<HTMLElement>("td");

      return {
        wrapperBorderTopWidth: wrapper ? getComputedStyle(wrapper).borderTopWidth : null,
        wrapperBorderRadius: wrapper ? getComputedStyle(wrapper).borderRadius : null,
        thTextTransform: th ? getComputedStyle(th).textTransform : null,
        thLetterSpacing: th ? getComputedStyle(th).letterSpacing : null,
        tdPaddingTop: td ? getComputedStyle(td).paddingTop : null,
      };
    });

    expect(Number.parseFloat(snapshot.wrapperBorderTopWidth ?? "0")).toBeGreaterThan(0);
    expect(Number.parseFloat(snapshot.wrapperBorderRadius ?? "0")).toBeGreaterThan(0);
    expect(snapshot.thTextTransform).toBe("uppercase");
    expect(Number.parseFloat(snapshot.thLetterSpacing ?? "0")).toBeGreaterThan(0);
    expect(Number.parseFloat(snapshot.tdPaddingTop ?? "0")).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
}

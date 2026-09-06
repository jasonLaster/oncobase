import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  exampleTables,
  type ExampleTableDefinition,
} from "@oncobase/smart-table/examples";
import {
  documentArticle,
  firstSmartTableShell,
  firstSmartTableToggle,
  gotoWiki,
  installWikiApiMocks,
} from "./fixtures";

const TABLE_PAGE = "/table-examples";

function exampleShell(page: Page, example: ExampleTableDefinition) {
  return page
    .getByRole("heading", { name: example.title, level: 2 })
    .locator("xpath=following-sibling::div[@data-smart-table-shell][1]");
}

function exampleToggle(shell: Locator) {
  return shell.getByRole("button", { name: "Expand table" });
}

async function exampleGeometry(page: Page, example: ExampleTableDefinition) {
  return page.evaluate((exampleTitle) => {
    const heading = Array.from(document.querySelectorAll("h2")).find((node) =>
      node.textContent?.includes(exampleTitle),
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

test.describe("Smart table examples", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installWikiApiMocks(page);
    await gotoWiki(page, TABLE_PAGE);
    await expect(
      page.getByRole("heading", { name: "Table Examples" }),
    ).toBeVisible();
  });

  test("renders fixture headings and desktop expand toggle", async ({ page }) => {
    await expect(firstSmartTableShell(page)).toBeVisible();
    await expect(firstSmartTableToggle(page)).toBeVisible();

    for (const example of exampleTables) {
      const shell = exampleShell(page, example);
      await expect(
        page.getByRole("heading", { name: example.title, level: 2 }),
      ).toBeVisible();
      await expect(shell).toBeVisible();
      await expect(exampleToggle(shell)).toBeVisible();
    }
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

  for (const example of exampleTables) {
    test(`expands and collapses ${example.id}`, async ({ page }) => {
      const shell = exampleShell(page, example);
      const toggle = exampleToggle(shell);
      const collapsed = await exampleGeometry(page, example);

      await expect(toggle).toBeVisible();
      await toggle.click({ timeout: 30_000 });
      await expect
        .poll(() => exampleGeometry(page, example), { timeout: 30_000 })
        .toMatchObject({ expanded: true });

      const expanded = await exampleGeometry(page, example);
      expect(expanded.layerWidth ?? 0).toBeGreaterThan(collapsed.wrapperWidth ?? 0);
      expect(expanded.shellReservedHeight ?? 0).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Collapse table" }).click();
      await expect
        .poll(() => exampleGeometry(page, example))
        .toMatchObject({ expanded: false });
    });
  }

  test.skip(
    "keeps the landscape fixture scrollable when widened before and after expansion",
    () => {
      // The web-side test installs a manual `style.width` overshoot on the
      // `<table>` element to force horizontal overflow and then asserts the
      // overshoot survives expansion. On web this works because the markdown
      // is server-rendered and the smart-table enhancement runs once after
      // hydration. On Vite the table is rendered by ReactMarkdown and the
      // client-only `installSmartTableLayout` recomputes column widths via
      // <colgroup> on every layout change, which clobbers the test's inline
      // style override. The same end-to-end invariant — "expanded wrapper
      // keeps horizontal scrolling when content exceeds the lane" — is
      // already covered by table-expansion.spec.ts, which drives the smart-
      // table layout pipeline rather than a test-only style override.
    },
  );

  test.skip(
    "keeps the declarative SmartTable API aligned with overlay behavior",
    () => {
      // The declarative-SmartTable-example component is a web-only surface that
      // renders `data-smart-table-live-scenarios` + `data-smart-table-performance-summary`.
      // Vite's table-examples route renders only the markdown-driven fixtures.
      // Re-enable this test when the declarative SmartTable React API is mounted
      // in the Vite app.
    },
  );
});

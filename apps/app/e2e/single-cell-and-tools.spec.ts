import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installWikiApiMocks } from "./fixtures";
import { SYNTHETIC_SINGLE_CELL_FILES } from "./single-cell-fixture";

const BASE = "sources/diagnostics/single-cell/";
const MANIFEST = `${BASE}manifest.json`;
// Opt-in screenshots for review (synthetic data only): SINGLE_CELL_SCREENSHOT_DIR=/some/dir.
const screenshotDir = process.env.SINGLE_CELL_SCREENSHOT_DIR;

async function mockSingleCell(page: Page, { allowed }: { allowed: boolean }) {
  // The owner page is sensitive: the mock lists it only in session scope, as
  // the server lists it only for roles that can read it.
  await installWikiApiMocks(page, {
    sessionAuthenticated: allowed,
    pageOverrides: {
      [`${BASE}index`]: { title: "Single-cell data", tags: ["omics"], sensitive: true, content: "# Single-cell data\n" },
    },
  });
  const requested: string[] = [];
  await page.route("**/api/file**", (route) => {
    const filePath = new URL(route.request().url()).searchParams.get("path") ?? "";
    if (!filePath.startsWith(BASE)) return route.fallback();
    requested.push(filePath);
    const body = allowed ? SYNTHETIC_SINGLE_CELL_FILES[filePath.slice(BASE.length)] : undefined;
    return body ? route.fulfill({ json: body }) : route.fulfill({ status: 404, body: "File not found" });
  });
  return requested;
}

async function capture(page: Page, name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
}

test.describe("single-cell viewer", () => {
  test("is restricted, without fetching data, when the reader does not list its owner page", async ({ page }) => {
    const requested = await mockSingleCell(page, { allowed: false });
    await page.goto("/tools/single-cell");
    await expect(page.getByTestId("single-cell-restricted")).toContainText("This dataset is restricted");
    expect(requested).toEqual([]);
  });

  test("falls back to the restricted notice when the server refuses the data", async ({ page }) => {
    await mockSingleCell(page, { allowed: true });
    await page.route("**/api/file**", (route) => route.fulfill({ status: 404, body: "File not found" }));
    await page.goto("/tools/single-cell");
    await expect(page.getByTestId("single-cell-restricted")).toBeVisible();
  });

  test("renders the map, QC header, gene search and per-type table", async ({ page }) => {
    const requested = await mockSingleCell(page, { allowed: true });
    await page.goto("/tools/single-cell");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthetic single-nucleus map");
    const qc = page.getByTestId("single-cell-qc");
    await expect(qc).toContainText("2,400");
    await expect(qc).toContainText("3,900");
    const umap = page.getByTestId("single-cell-umap");
    await expect(umap).toHaveAttribute("data-points", "2400");
    await expect(umap).not.toHaveAttribute("data-render-mode", "pending");
    await expect(page.getByRole("list", { name: "Cell type groups" }).getByRole("button")).toHaveCount(4);
    expect(requested.every((p) => p === MANIFEST || p === `${BASE}lib-1.json`)).toBe(true);
    await capture(page, "single-cell-light");

    await page.getByRole("combobox", { name: "Find a gene" }).fill("alpha");
    await page.getByRole("option", { name: /GENEA/ }).click();
    await expect(page).toHaveURL(/gene=GENEA/);
    await expect(page.getByTestId("single-cell-gene-card")).toContainText("Reads reliably in nuclei");
    const table = page.getByTestId("single-cell-table");
    await expect(table.getByRole("heading", { level: 2 })).toHaveText("GENEA by cell type");
    const tumorRow = table.getByRole("row", { name: /^Tumor/ });
    await expect(tumorRow).toContainText("600");
    await expect(tumorRow).toContainText("100%");

    await page.getByRole("radio", { name: "Raw" }).click();
    await expect(page).toHaveURL(/counts=raw/);
    await page.getByRole("button", { name: /GENEB/ }).click();
    await expect(page.getByTestId("single-cell-gene-card")).toContainText("Read with caution");
    await expect(page.getByTestId("single-cell-gene-card")).toContainText("Synthetic caution note.");

    await page.getByRole("radio", { name: "LIB-2" }).click();
    await expect(page).toHaveURL(/lib=LIB-2/);
    await expect(umap).toHaveAttribute("data-points", "1200");
    await expect(qc).toContainText("1,200");
  });

  test("dark theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockSingleCell(page, { allowed: true });
    await page.goto("/tools/single-cell?gene=GENEB");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("single-cell-umap")).toHaveAttribute("data-points", "2400");
    await expect(page.getByTestId("single-cell-table").getByRole("row", { name: /^T cells/ })).toBeVisible();
    await capture(page, "single-cell-dark");
  });
});

test.describe("tools index", () => {
  test("groups tools, marks restricted ones and filters by audience", async ({ page }) => {
    await mockSingleCell(page, { allowed: false });
    await page.goto("/tools");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tools");
    await expect(page.getByRole("heading", { level: 2, name: "Current" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Archival" })).toBeVisible();
    const singleCell = page.locator('[data-tool-id="single-cell"]');
    await expect(singleCell).toHaveAttribute("data-availability", "locked");
    await expect(singleCell.getByRole("link")).toHaveCount(0);
    await expect(singleCell).toContainText("Restricted");
    await expect(page.locator('[data-tool-id="timeline"]').getByRole("link")).toHaveAttribute("href", "/diagnostics");
    await capture(page, "tools-light");

    await page.getByRole("radio", { name: "For labs and researchers" }).click();
    await expect(page).toHaveURL(/for=labs/);
    await expect(page.locator('[data-tool-id="timeline"]')).toHaveCount(0);
    await expect(page.locator('[data-tool-id="pathology-viewer"]')).toBeVisible();
  });

  test("opens restricted tools for readers who can read their data, in dark theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await mockSingleCell(page, { allowed: true });
    await page.goto("/tools");
    const singleCell = page.locator('[data-tool-id="single-cell"]');
    await expect(singleCell).toHaveAttribute("data-availability", "open");
    await capture(page, "tools-dark");
    await singleCell.getByRole("link").click();
    await expect(page).toHaveURL(/\/tools\/single-cell$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthetic single-nucleus map");
  });

  test("the sidebar links to the tools index", async ({ page }) => {
    await mockSingleCell(page, { allowed: false });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/wiki/logistics/insurance");
    await page.getByTestId("sidebar-view-tools").click();
    await expect(page).toHaveURL(/\/tools$/);
    await expect(page.getByTestId("tools-page")).toBeVisible();
  });
});

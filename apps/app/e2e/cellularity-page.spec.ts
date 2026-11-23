import { expect, test, type Page } from "@playwright/test";
import { syntheticCellularityData } from "./cellularity-fixture";
import { installWikiApiMocks } from "./fixtures";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function openCellularity(page: Page) {
  await installWikiApiMocks(page);
  await page.route("**/api/file**", (route) => {
    const path = new URL(route.request().url()).searchParams.get("path") ?? "";
    if (!path.startsWith("sources/diagnostics/cellularity/")) return route.fallback();
    if (path.endsWith("data.json")) return route.fulfill({ json: syntheticCellularityData() });
    return route.fulfill({ contentType: "image/png", body: PIXEL });
  });
  await page.goto("/diagnostics/cellularity");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthetic cellularity explorer");
}

test("bed views are tabs and the slice strip selects one block", async ({ page }) => {
  await openCellularity(page);
  const views = page.getByRole("tablist", { name: "Tumor bed view" });
  await expect(views.getByRole("tab", { name: "3D Tumor Model" })).toHaveAttribute("aria-selected", "true");

  await views.getByRole("tab", { name: "3D Tumor Model" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(views.getByRole("tab", { name: "Breadloaf Slices" })).toHaveAttribute("aria-selected", "true");
  const breadloaf = page.getByRole("tabpanel", { name: "Breadloaf Slices" });
  await expect(breadloaf.getByRole("slider", { name: "Spread" })).toBeVisible();
  await expect(breadloaf.getByRole("checkbox", { name: "41×20 mm bed box" })).toBeChecked();
  await breadloaf.getByRole("checkbox", { name: "41×20 mm bed box" }).click();
  await expect(breadloaf.getByRole("checkbox", { name: "41×20 mm bed box" })).not.toBeChecked();

  await views.getByRole("tab", { name: "All Bed Blocks" }).click();
  const blocks = page.getByRole("group", { name: "Bed blocks" });
  await expect(blocks.getByRole("button", { name: /^B6/ })).toHaveAttribute("aria-pressed", "true");
  await blocks.getByRole("button", { name: /^B4/ }).click();
  await expect(blocks.getByRole("button", { name: /^B4/ })).toHaveAttribute("aria-pressed", "true");

  const strip = page.getByRole("group", { name: "Inspect block" });
  await expect(strip.getByRole("button", { name: "B4 slice" })).toHaveAttribute("aria-pressed", "true");
  await strip.getByRole("button", { name: "C1 shave" }).click();
  await expect(strip.getByRole("button", { name: "C1 shave" })).toHaveAttribute("aria-pressed", "true");
  await expect(strip.getByRole("button", { name: "B4 slice" })).toHaveAttribute("aria-pressed", "false");
});

test("expand all opens and closes every drawer, and each drawer still toggles alone", async ({ page }) => {
  await openCellularity(page);
  const expandAll = page.getByRole("button", { name: "Expand all details" });
  const drawers = page.locator(".cel-drawer-trigger");
  await expect(drawers).toHaveCount(7);
  await expect(page.locator('.cel-drawer-trigger[aria-expanded="true"]')).toHaveCount(0);

  await page.getByRole("button", { name: /Hot fields/ }).click();
  await expect(page.getByRole("button", { name: /Hot fields/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Hot fields body")).toBeVisible();

  await expandAll.click();
  await expect(expandAll).toHaveAttribute("aria-pressed", "true");
  await expect(expandAll).toHaveText("Collapse all details");
  await expect(page.locator('.cel-drawer-trigger[aria-expanded="true"]')).toHaveCount(7);

  await page.getByRole("button", { name: /QC crops/ }).click();
  await expect(page.locator('.cel-drawer-trigger[aria-expanded="true"]')).toHaveCount(6);

  await expandAll.click();
  await expect(expandAll).toHaveText("Expand all details");
  await expect(page.locator('.cel-drawer-trigger[aria-expanded="true"]')).toHaveCount(0);
  await expect(page.getByText("Hot fields body")).toBeHidden();
});

test("drawer tabs switch their panels", async ({ page }) => {
  await openCellularity(page);
  await page.getByRole("button", { name: /^Method/ }).click();
  const method = page.getByRole("tablist", { name: "Method" });
  await expect(page.getByText("Stain body")).toBeVisible();
  await method.getByRole("tab", { name: "Count" }).click();
  await expect(page.getByRole("tabpanel", { name: "Count" })).toContainText("Count bullet");
  await expect(page.getByText("Stain body")).toBeHidden();

  await page.getByRole("button", { name: /^Serial sections/ }).click();
  const serial = page.getByRole("tablist", { name: "Serial sections" });
  await serial.getByRole("tab", { name: "Section B" }).click();
  await expect(page.getByRole("tabpanel", { name: "Section B" }).getByRole("img", { name: "Section B" })).toBeVisible();
});

test("sliders are named, move with the keyboard, and presets press their toggle", async ({ page }) => {
  await openCellularity(page);
  const area = page.getByRole("slider", { name: "Area circled" });
  await expect(area).toHaveAttribute("aria-valuetext", "5 mm²");
  const presets = page.getByRole("group", { name: "Circled area presets" });
  await expect(presets.getByRole("button", { name: "Dense focus" })).toHaveAttribute("aria-pressed", "true");
  await presets.getByRole("button", { name: "Whole block" }).click();
  await expect(area).toHaveAttribute("aria-valuetext", "40 mm²");
  await expect(presets.getByRole("button", { name: "Whole block" })).toHaveAttribute("aria-pressed", "true");
  await area.focus();
  await page.keyboard.press("Home");
  await expect(area).toHaveAttribute("aria-valuetext", "1 mm²");
  await expect(presets.getByRole("button", { name: "1 field" })).toHaveAttribute("aria-pressed", "true");

  const rcb = page.getByRole("slider", { name: "Tumor-bed cellularity" });
  await expect(rcb).toHaveAttribute("aria-valuetext", "1.0%");
  await page.getByRole("group", { name: "Cellularity presets" }).getByRole("button", { name: "10%" }).click();
  await expect(rcb).toHaveAttribute("aria-valuetext", "10.0%");

  await page.getByRole("button", { name: "Expand all details" }).click();
  const panck = page.getByRole("slider", { name: "Inspect PanCK threshold" });
  await expect(panck).toHaveAttribute("aria-valuetext", "0.07");
  await panck.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(panck).toHaveAttribute("aria-valuetext", "0.05");
});

test("the 3D camera bar is a toolbar with toggles", async ({ page }) => {
  await openCellularity(page);
  const toolbar = page.getByRole("toolbar", { name: "3D view" });
  test.skip(!(await toolbar.isVisible()), "WebGL is unavailable in this browser");
  const camera = toolbar.getByRole("group", { name: "Camera" });
  await expect(camera.getByRole("button", { name: "Isometric" })).toHaveAttribute("aria-pressed", "true");
  await camera.getByRole("button", { name: "Anterior" }).click();
  await expect(camera.getByRole("button", { name: "Anterior" })).toHaveAttribute("aria-pressed", "true");
  await camera.getByRole("button", { name: "Anterior" }).click();
  await expect(camera.getByRole("button", { name: "Anterior" })).toHaveAttribute("aria-pressed", "true");

  const spin = toolbar.getByRole("button", { name: "Spin" });
  await spin.click();
  await expect(spin).toHaveAttribute("aria-pressed", "true");

  const slidesOnly = toolbar.getByRole("button", { name: "Slides only" });
  await slidesOnly.click();
  await expect(slidesOnly).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox", { name: "3D core (≥5% / ≥12%)" })).not.toBeChecked();

  await expect(toolbar.getByRole("button", { name: "Previous slide" })).toBeVisible();
  await toolbar.getByRole("button", { name: "Next slide" }).hover();
  await expect(page.getByRole("tooltip", { name: "Next slide" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Hull opacity" })).toBeVisible();
});

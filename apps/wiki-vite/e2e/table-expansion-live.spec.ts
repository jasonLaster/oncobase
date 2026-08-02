import { expect, test, type Page } from "@playwright/test";
import { documentArticle, firstSmartTableToggle } from "./fixtures";
import { ensurePasswordGateSession } from "./gate-auth";

const DOCUMENT_PATH = "/";

test("keeps an expanded table stable through real comments rail transitions", async ({
  page,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_BASE_URL,
    "Real comments rail verification only runs against a deployed Vite runtime",
  );
  test.setTimeout(90_000);

  await ensurePasswordGateSession(page);
  const configResponse = await page.request.get("/api/liveblocks-auth");
  expect(configResponse.ok()).toBe(true);
  const config = (await configResponse.json()) as {
    configured: boolean;
    reason?: string | null;
  };
  test.skip(
    !config.configured,
    `Liveblocks integration unavailable: ${config.reason ?? "credentials-missing"}`,
  );

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.localStorage.setItem("comments-pane-open", "0");
    window.localStorage.setItem("comments-pane-width", "384");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(DOCUMENT_PATH, { waitUntil: "domcontentloaded" });
  await expect(documentArticle(page)).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(async () => (await documentArticle(page).textContent())?.trim().length ?? 0)
    .toBeGreaterThan(100);
  await expect(firstSmartTableToggle(page)).toBeVisible();

  await firstSmartTableToggle(page).click();
  const layer = page.locator(".table-expansion-layer");
  await expect(layer).toHaveCount(1);
  await expect(layer).toBeVisible();
  const persistenceKey = await layer.getAttribute("data-smart-table-layer");
  expect(persistenceKey).toBeTruthy();

  const collapsed = await railMetrics(page);
  expect(collapsed.rightRail.width).toBeLessThan(100);
  assertLayerBetweenRails(collapsed);

  await page.getByRole("button", { name: "Open comments" }).click();
  await expect(
    page.locator('[data-comments-session-state="authenticated"], [data-comments-session-state="guest"]'),
  ).toBeVisible({ timeout: 20_000 });
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute("data-smart-table-layer", persistenceKey!);

  const activeRail = page.locator("[data-wiki-shell-right-rail]");
  await activeRail.getByRole("button", { name: "Open comments" }).click();
  await expect
    .poll(async () => (await railMetrics(page)).rightRail.width)
    .toBeGreaterThan(300);

  const firstOpen = await railMetrics(page);
  assertLayerBetweenRails(firstOpen);
  expect(firstOpen.layer.width).toBeLessThan(collapsed.layer.width - 200);
  await assertExpandedLayerRestored(page, persistenceKey!);

  await activeRail.getByRole("button", { name: "Collapse comments pane" }).click();
  await expect
    .poll(async () => (await railMetrics(page)).layer.width)
    .toBeGreaterThan(firstOpen.layer.width + 200);
  const firstClosed = await railMetrics(page);
  assertLayerBetweenRails(firstClosed);
  await assertExpandedLayerRestored(page, persistenceKey!);

  await activeRail.getByRole("button", { name: "Open comments" }).click();
  await expect
    .poll(async () => (await railMetrics(page)).layer.width)
    .toBeLessThan(firstClosed.layer.width - 200);
  const secondOpen = await railMetrics(page);
  assertLayerBetweenRails(secondOpen);
  expect(Math.abs(secondOpen.layer.width - firstOpen.layer.width)).toBeLessThan(2);
  await assertExpandedLayerRestored(page, persistenceKey!);

  await activeRail.getByRole("button", { name: "Collapse comments pane" }).click();
  await expect
    .poll(async () => (await railMetrics(page)).layer.width)
    .toBeGreaterThan(secondOpen.layer.width + 200);
  const secondClosed = await railMetrics(page);
  assertLayerBetweenRails(secondClosed);
  expect(Math.abs(secondClosed.layer.width - firstClosed.layer.width)).toBeLessThan(2);
  await assertExpandedLayerRestored(page, persistenceKey!);

  expect(pageErrors).toEqual([]);
});

type RailMetrics = Awaited<ReturnType<typeof railMetrics>>;

function assertLayerBetweenRails(metrics: RailMetrics) {
  expect(metrics.layer.left).toBeGreaterThanOrEqual(metrics.leftRail.right + 16);
  expect(metrics.layer.right).toBeLessThanOrEqual(metrics.rightRail.left - 16);
}

async function assertExpandedLayerRestored(page: Page, persistenceKey: string) {
  await expect(page.locator(".table-expansion-layer")).toHaveCount(1);
  await expect(page.locator('[aria-label="Collapse table"]')).toHaveCount(1);
  await expect(page.locator(".table-expansion-layer")).toHaveAttribute(
    "data-smart-table-layer",
    persistenceKey,
  );
}

async function railMetrics(page: Page) {
  return page.evaluate(() => {
    const isVisible = (element: HTMLElement | null) => {
      if (!element) return false;
      const box = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.display !== "none";
    };
    const rect = (element: HTMLElement | null, label: string) => {
      if (!element) throw new Error(`Missing ${label}`);
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        width: box.width,
      };
    };

    const leftRail = isVisible(
      document.querySelector<HTMLElement>("[data-sidebar-expanded-rail]"),
    )
      ? document.querySelector<HTMLElement>("[data-sidebar-expanded-rail]")
      : document.querySelector<HTMLElement>("[data-sidebar-collapsed-rail]");

    return {
      layer: rect(
        document.querySelector<HTMLElement>(".table-expansion-layer"),
        "expanded table layer",
      ),
      leftRail: rect(leftRail, "left navigation rail"),
      rightRail: rect(
        document.querySelector<HTMLElement>("[data-wiki-shell-right-rail]"),
        "right document rail",
      ),
    };
  });
}

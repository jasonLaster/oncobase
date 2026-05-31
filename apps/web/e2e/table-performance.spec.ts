import { expect, test, type Page } from "@playwright/test";
import { resizeAuditExampleTables } from "@oncobase/smart-table/examples";

const TABLE_PAGE = "/table-examples";
const isProdRun = process.env.TEST_ENV === "prod";

type ResizeFrameMetrics = {
  sampleCount: number;
  averageFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  longFrameCount: number;
};

test.describe("Smart table resize performance", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(TABLE_PAGE);
    await expect(
      page.getByRole("heading", { name: "Smart Table Examples" })
    ).toBeVisible();
  });

  test("keeps resize interactions responsive across the audit fixtures", async ({
    page,
  }) => {
    test.skip(
      isProdRun,
      "Frame-timing assertions are too noisy for repeated deployed-prod stress."
    );

    test.slow();

    const results: Array<{ id: string; metrics: ResizeFrameMetrics }> = [];

    for (const example of resizeAuditExampleTables) {
      const metrics = await measureResizeFrames(page, example.id);
      results.push({ id: example.id, metrics });
    }

    for (const result of results) {
      expect(result.metrics.sampleCount).toBeGreaterThan(8);
      expect(result.metrics.averageFrameMs).toBeLessThan(20);
      expect(result.metrics.p95FrameMs).toBeLessThan(28);
      expect(result.metrics.longFrameCount).toBeLessThanOrEqual(5);
    }
  });
});

async function measureResizeFrames(
  page: Page,
  exampleId: string
): Promise<ResizeFrameMetrics> {
  const resizeTarget = page
    .locator(`[data-resize-audit-example="${exampleId}"] .smart-table-resize-target`)
    .first();
  await expect(resizeTarget).toBeVisible();

  const box = await resizeTarget.boundingBox();
  if (!box) {
    throw new Error(`Missing resize target box for ${exampleId}`);
  }

  const startX = box.x + box.width - 2;
  const startY = box.y + box.height / 2;

  await page.mouse.move(startX, startY);
  await page.waitForTimeout(60);

  await page.evaluate(() => {
    const state = {
      deltas: [] as number[],
      lastFrame: 0,
      stop: false,
    };
    (window as typeof window & { __smartTablePerf?: typeof state }).__smartTablePerf =
      state;

    const tick = (now: number) => {
      const currentState = (
        window as typeof window & { __smartTablePerf?: typeof state }
      ).__smartTablePerf;
      if (!currentState || currentState.stop) {
        return;
      }

      if (currentState.lastFrame !== 0) {
        currentState.deltas.push(now - currentState.lastFrame);
      }
      currentState.lastFrame = now;
      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
  });

  await page.mouse.down();
  for (let step = 1; step <= 28; step += 1) {
    await page.mouse.move(startX + step * 8, startY, { steps: 1 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);

  return page.evaluate(() => {
    const currentState = (
      window as typeof window & {
        __smartTablePerf?: {
          deltas: number[];
          lastFrame: number;
          stop: boolean;
        };
      }
    ).__smartTablePerf;

    if (!currentState) {
      throw new Error("Missing smart table performance monitor");
    }

    currentState.stop = true;
    const deltas = currentState.deltas.filter(
      (value) => Number.isFinite(value) && value > 0 && value < 100
    );
    const sorted = [...deltas].sort((left, right) => left - right);
    const averageFrameMs =
      deltas.reduce((sum, value) => sum + value, 0) / Math.max(deltas.length, 1);
    const p95Index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(sorted.length * 0.95))
    );

    return {
      sampleCount: deltas.length,
      averageFrameMs,
      p95FrameMs: sorted[p95Index] ?? 0,
      maxFrameMs: sorted[sorted.length - 1] ?? 0,
      longFrameCount: deltas.filter((value) => value > 20).length,
    };
  });
}

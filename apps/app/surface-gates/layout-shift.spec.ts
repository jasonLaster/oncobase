/**
 * Layout shift during a cold load, per surface (light theme), with the CPU slowed 4x so
 * hand-offs between data sources (server HTML, inlined payload, local store) land in separate
 * frames. Fails at Google's "good" CLS limit of 0.1.
 *
 * This caught markdown tables remounting on every data hand-off (each remount re-ran smart-table
 * sizing and shifted the page: 0.162 on reader-big-tables against 0.055 before).
 */
import { expect, test } from "@playwright/test";
import { surfaceCases } from "./surfaces";
import { newSurfaceContext, openSurface } from "./support";

const MAX_CLS = 0.1;
/** Time after the surface is ready for late enhancements (tables, tree, fonts) to settle. */
const SETTLE_MS = 2_500;

for (const { surface, theme, viewport, key } of surfaceCases()) {
  if (theme !== "light") continue;
  test(`layout shift ${key}`, async ({ browser }) => {
    const context = await newSurfaceContext(browser, { auth: surface.auth, theme, viewport });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        const state = { cls: 0, shifts: [] as string[] };
        (window as unknown as { __layoutShift: typeof state }).__layoutShift = state;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: Array<{ node?: Node | null }> }>) {
            if (entry.hadRecentInput) continue;
            state.cls += entry.value;
            const nodes = (entry.sources ?? []).map(({ node }) => node instanceof Element ? `${node.nodeName.toLowerCase()}.${node.classList[0] ?? ""}` : "?");
            state.shifts.push(`${Math.round(entry.startTime)}ms ${entry.value.toFixed(4)} ${nodes.slice(0, 3).join(" ")}`);
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await openSurface(page, surface);
      await page.waitForTimeout(SETTLE_MS);
      const { cls, shifts } = await page.evaluate(() => (window as unknown as { __layoutShift: { cls: number; shifts: string[] } }).__layoutShift);
      expect(cls, `layout shifts:\n${shifts.join("\n")}`).toBeLessThan(MAX_CLS);
    } finally {
      await context.close();
    }
  });
}

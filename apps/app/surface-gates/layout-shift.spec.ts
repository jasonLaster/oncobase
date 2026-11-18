/**
 * Layout shift during a cold load, per surface (light theme), with the CPU slowed 4x so
 * hand-offs between data sources (server HTML, inlined payload, local store) land in separate
 * frames. Fails at Google's "good" CLS limit of 0.1.
 *
 * This caught markdown tables remounting on every data hand-off (each remount re-ran smart-table
 * sizing and shifted the page: 0.162 on reader-big-tables against 0.055 before).
 */
import { expect, test, type Browser } from "@playwright/test";
import { surfaceById, surfaceCases, type Surface } from "./surfaces";
import { newSurfaceContext, openSurface } from "./support";

const MAX_CLS = 0.1;
/** Time after the surface is ready for late enhancements (tables, tree, fonts) to settle. */
const SETTLE_MS = 2_500;

async function measureLayoutShift(browser: Browser, surface: Surface, viewport: "desktop" | "mobile",
  storage: Record<string, string> = {}) {
  const context = await newSurfaceContext(browser, { auth: surface.auth, theme: "light", viewport });
  try {
    const page = await context.newPage();
    await page.addInitScript((entries) => {
      // Test fixture running in the page: seeds a saved preference before boot.
      // eslint-disable-next-line no-restricted-globals
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
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
    }, storage);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await openSurface(page, surface);
    await page.waitForTimeout(SETTLE_MS);
    return await page.evaluate(() => (window as unknown as { __layoutShift: { cls: number; shifts: string[] } }).__layoutShift);
  } finally {
    await context.close();
  }
}

for (const { surface, theme, viewport, key } of surfaceCases()) {
  if (theme !== "light") continue;
  test(`layout shift ${key}`, async ({ browser }) => {
    const { cls, shifts } = await measureLayoutShift(browser, surface, viewport);
    expect(cls, `layout shifts:\n${shifts.join("\n")}`).toBeLessThan(MAX_CLS);
  });
}

// A saved sidebar preference applies before the first paint (wiki-shell sidebar-startup.ts),
// so a shell rendered without it (server HTML, stage 1 of plans/2026-11-17-server-rendering-plan.md)
// never shifts when the client takes over. The spike measured 0.078 and 0.155 without it.
for (const [label, width] of [["a saved 360 px sidebar", "360"], ["a collapsed sidebar", "0"]] as const) {
  test(`layout shift reader-article.light.desktop with ${label}`, async ({ browser }) => {
    const { cls, shifts } = await measureLayoutShift(browser, surfaceById("reader-article"), "desktop", { "sidebar-width": width });
    expect(cls, `layout shifts:\n${shifts.join("\n")}`).toBeLessThan(MAX_CLS);
  });
}

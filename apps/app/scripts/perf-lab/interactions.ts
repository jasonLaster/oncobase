// Interaction scenarios on a warm, signed-in desktop reader, at 1x and 4x CPU.
import { ARTICLE, PALETTE_INPUT, TREE_ROOT, instrument, newContext, settle, type Browser, type Page } from "./browser";
import { median } from "./stats";
import { PAGES } from "./vault";

export const CPU_RATES = [1, 4] as const;

/** Per-iteration values; each is a median over the repeated actions in that iteration. */
export type InteractionSample = {
  /** Four folder expands of growing size (3 children up to 62 files, the last one virtualized). */
  treeExpandMs: number;
  treeExpandLongestTaskMs: number;
  /** Tree clicks to five ~6-11 KB pages not yet opened in this session. */
  navSmallMs: number;
  /** Tree click to the 279 KB page with 30 tables. */
  navLargeMs: number;
  navLargeLongestTaskMs: number;
  paletteOpenMs: number;
  /** Event Timing duration per keystroke (12 keys); events under 16 ms report as 0. */
  paletteKeystrokeMs: number;
  paletteKeystrokeMaxMs: number;
};

type Timed = { ms: number; longestTaskMs: number; eventMs: number };

const row = (kind: "file" | "directory", slug: string) => `[data-tree-row*=":${kind}:${slug}:"]`;
const visibleRows = (page: Page) => page.evaluate((root) => Number(document.querySelector(root)?.getAttribute("data-visible-row-count") ?? 0), TREE_ROOT);

/**
 * Time from the first pointerdown/keydown of `action` until `done` (a JS
 * expression evaluated in the page) holds and two frames have painted.
 * Long tasks and event durations are those observed in that window.
 */
export async function timed(page: Page, action: () => Promise<void>, done: string): Promise<Timed> {
  await page.evaluate(() => {
    const w = window as unknown as { __perfLab: { events: unknown[]; longTasks: unknown[] }; __perfLabT0: number };
    w.__perfLab.events.length = 0;
    w.__perfLab.longTasks.length = 0;
    w.__perfLabT0 = 0;
    const first = (e: Event) => { if (!w.__perfLabT0) w.__perfLabT0 = e.timeStamp; };
    for (const type of ["pointerdown", "keydown"]) addEventListener(type, first, { capture: true, once: true });
  });
  await action();
  const ms = await page.evaluate(async (expr) => {
    const w = window as unknown as { __perfLabT0: number };
    const holds = () => { try { return !!(0, eval)(expr); } catch { return false; } };
    const start = performance.now();
    while (!holds() && performance.now() - start < 20_000) await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return holds() ? Math.round(performance.now() - (w.__perfLabT0 || start)) : Number.NaN;
  }, done);
  await page.waitForTimeout(350);
  const window_ = await page.evaluate(() => {
    const lab = (window as unknown as { __perfLab: { events: Array<{ duration: number; interactionId: number }>; longTasks: Array<[number, number]> } }).__perfLab;
    return { longTasks: lab.longTasks.map((t) => t[1]), events: lab.events.filter((e) => e.interactionId).map((e) => e.duration) };
  });
  return { ms, longestTaskMs: Math.max(0, ...window_.longTasks), eventMs: Math.max(0, ...window_.events) };
}

const clickRow = (page: Page, selector: string) => async () => { await page.locator(selector).first().locator("a,button").first().click(); };

export async function navigate(page: Page, slug: string): Promise<Timed> {
  const before = await page.evaluate(() => document.querySelector("main h1, h1")?.textContent ?? "");
  // The tree collapses non-ancestor folders after navigation: expand each ancestor first.
  const parts = slug.split("/");
  for (let i = 1; i < parts.length; i++) {
    const button = page.locator(row("directory", parts.slice(0, i).join("/"))).first().locator("button").first();
    if (await button.count() && (await button.getAttribute("aria-expanded")) === "false") {
      await button.click();
      await page.waitForTimeout(150);
    }
  }
  await page.locator(row("file", slug)).first().scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => undefined);
  return timed(page, clickRow(page, row("file", slug)),
    `location.pathname === ${JSON.stringify(`/${slug}`)} && !!document.querySelector(${JSON.stringify(ARTICLE)}) && (document.querySelector("main h1, h1")?.textContent ?? "") !== ${JSON.stringify(before)}`);
}

export async function runInteractionIteration(browser: Browser, base: string, cpu: number): Promise<InteractionSample> {
  const context = await newContext(browser, base, "desktop", { signedIn: true });
  try {
    const page = await context.newPage();
    const tools = await instrument(page, "desktop", base);
    await page.goto(`${base}/${PAGES.article}`, { waitUntil: "commit", timeout: 60_000 });
    await page.waitForSelector(ARTICLE, { timeout: 60_000 });
    await settle(page, 6000);
    if (cpu > 1) await tools.setCpu(cpu);

    // Same order as the baseline run: folder expands first, then navigation, then the palette.
    const expands: Timed[] = [];
    for (const dir of ["sources", "sources/papers", "sources/papers/2024", "sources/papers/2025"]) {
      const n = await visibleRows(page);
      expands.push(await timed(page, clickRow(page, row("directory", dir)), `Number(document.querySelector(${JSON.stringify(TREE_ROOT)})?.getAttribute("data-visible-row-count") ?? 0) > ${n}`));
    }
    const n = await visibleRows(page);
    await timed(page, clickRow(page, row("directory", "sources/papers/2025")), `Number(document.querySelector(${JSON.stringify(TREE_ROOT)})?.getAttribute("data-visible-row-count") ?? 0) < ${n}`);

    const small: Timed[] = [];
    for (const slug of PAGES.small) small.push(await navigate(page, slug));
    const large = await navigate(page, PAGES.large);

    const open = await timed(page, async () => { await page.keyboard.press("ControlOrMeta+k"); }, `!!document.querySelector(${JSON.stringify(PALETTE_INPUT)})`);
    const keys: number[] = [];
    for (const ch of "paper 2024 3") keys.push((await timed(page, async () => { await page.keyboard.type(ch); }, "true")).eventMs);

    return {
      treeExpandMs: median(expands.map((t) => t.ms)),
      treeExpandLongestTaskMs: Math.max(0, ...expands.map((t) => t.longestTaskMs)),
      navSmallMs: median(small.map((t) => t.ms)),
      navLargeMs: large.ms,
      navLargeLongestTaskMs: large.longestTaskMs,
      paletteOpenMs: open.ms,
      paletteKeystrokeMs: median(keys),
      paletteKeystrokeMaxMs: Math.max(0, ...keys),
    };
  } finally {
    await context.close();
  }
}

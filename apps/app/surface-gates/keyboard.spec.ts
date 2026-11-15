/**
 * Scripted keyboard checks axe cannot do, written against the reader's keyboard contract:
 *
 * - The skip link is the first focusable element (`data-test-id="skip-link"`) and targets
 *   `main#main-content`; focus is inside <main> within two Tab presses of load.
 * - After a client-side navigation focus moves to the article h1 (tabindex="-1"), and the polite
 *   live region `data-test-id="route-announcer"` reads "Loaded {page title}".
 * - Back restores the previous scroll position.
 * - Overlays keep Tab inside while open, close on Escape and return focus to their opener.
 * - No focusable element is invisible while focused.
 *
 * Ratchet: known-keyboard-failures.json lists checks that fail today. A listed check that now
 * passes fails with a request to remove it; a numeric check (Tab count, invisible stops) fails
 * if its number grew, and asks for an update if it shrank.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { surfaceById, type ViewportName } from "./surfaces";
import { RATCHET_HINT, UPDATE_RATCHET, finishTransitions, newSurfaceContext, openSurface, readJSON, settle, writeFragment } from "./support";
import { RATCHET_FILES } from "./ratchet-teardown";

type Result = { ok: boolean; detail: string; /** Lower is better. */ value?: number };
type Recorded = Record<string, { detail: string; value?: number }>;
const known = readJSON<Recorded>(RATCHET_FILES.keyboard!, {});

const ARTICLE_H1 = '[data-test-id="document-article"] h1';
const MAX_TABS = 40;

/** Describes the focused element for failure messages. */
const describeFocus = (page: Page) => page.evaluate(() => {
  const element = document.activeElement as HTMLElement | null;
  if (!element || element === document.body) return "<body>";
  const id = element.getAttribute("data-test-id");
  const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  return `${element.tagName.toLowerCase()}${id ? `[data-test-id=${id}]` : ""}${element.className && typeof element.className === "string" ? `.${element.className.split(" ")[0]}` : ""} "${label}"`;
});

const focusInside = (locator: Locator) => locator.evaluate((element) => element.contains(document.activeElement));

function keyboardCheck(id: string, surfaceId: string, viewport: ViewportName, run: (page: Page) => Promise<Result>) {
  const key = `${id}.${surfaceId}.${viewport}`;
  test(`keyboard ${key}`, async ({ browser }) => {
    const surface = surfaceById(surfaceId);
    const context = await newSurfaceContext(browser, { auth: surface.auth, theme: "light", viewport });
    try {
      const page = await context.newPage();
      await openSurface(page, surface, { runBefore: false });
      const result = await run(page);
      if (UPDATE_RATCHET) {
        writeFragment("keyboard", key, result.ok ? null : { detail: result.detail, ...(result.value === undefined ? {} : { value: result.value }) });
        return;
      }
      const before = known[key];
      if (!before) {
        expect(result.ok, `${key}: ${result.detail}`).toBe(true);
        return;
      }
      expect(result.ok, `${key} now passes. Remove it from known-keyboard-failures.json. ${RATCHET_HINT}`).toBe(false);
      if (result.value !== undefined && before.value !== undefined) {
        expect(result.value, `${key} got worse: ${result.detail}`).toBeLessThanOrEqual(before.value);
        expect(result.value, `${key} improved (${before.value} -> ${result.value}). ${RATCHET_HINT}`).toBe(before.value);
      }
    } finally {
      await context.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Skip link and Tab count.

for (const [surfaceId, viewport] of [
  ["reader-article", "desktop"], ["reader-article", "mobile"], ["reader-big-tables", "desktop"],
  ["reader-private-denied", "desktop"], ["not-found", "desktop"], ["tag", "desktop"],
] as const) {
  keyboardCheck("tabs-to-main", surfaceId, viewport, async (page) => {
    const path: string[] = [];
    for (let presses = 1; presses <= MAX_TABS; presses++) {
      await page.keyboard.press("Tab");
      path.push(await describeFocus(page));
      if (await page.evaluate(() => !!document.activeElement?.closest("main"))) {
        return { ok: presses <= 2, value: presses, detail: `${presses} Tab presses to reach <main>: ${path.slice(0, 4).join(" -> ")}${presses > 4 ? " -> ..." : ""}` };
      }
    }
    return { ok: false, value: MAX_TABS + 1, detail: `focus never entered <main> in ${MAX_TABS} presses: ${path.slice(0, 4).join(" -> ")} -> ...` };
  });
}

keyboardCheck("skip-link", "reader-article", "desktop", async (page) => {
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => {
    const element = document.activeElement as HTMLAnchorElement | null;
    return { skip: element?.getAttribute("data-test-id") === "skip-link", href: element?.getAttribute("href") ?? null };
  });
  if (!first.skip) return { ok: false, detail: `first Tab stop is ${await describeFocus(page)}, not [data-test-id=skip-link]` };
  if (first.href !== "#main-content") return { ok: false, detail: `skip link targets ${first.href}, not #main-content` };
  if (!(await page.locator("main#main-content").count())) return { ok: false, detail: "no main#main-content" };
  await page.keyboard.press("Enter");
  await settle(page, 200);
  const inMain = await page.evaluate(() => !!document.activeElement?.closest("main#main-content"));
  return { ok: inMain, detail: inMain ? "skip link moves focus into main" : `after the skip link, focus is on ${await describeFocus(page)}` };
});

// ---------------------------------------------------------------------------
// Client-side navigation: focus target, announcement, scroll restoration.

async function navigateWithTreeLink(page: Page, slug: string, title: string) {
  const link = page.locator(`[data-tree-row*=":file:${slug}:"] a`).first();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
  await expect(page.locator(ARTICLE_H1).filter({ visible: true })).toHaveText(title);
  await settle(page, 300);
}

keyboardCheck("route-focus", "reader-article", "desktop", async (page) => {
  await navigateWithTreeLink(page, "wiki/timeline", "Timeline");
  const target = await page.evaluate((selector) => {
    const active = document.activeElement;
    const h1 = [...document.querySelectorAll(selector)].find((element) => (element as HTMLElement).offsetParent !== null);
    return active === h1 ? "h1" : active?.tagName === "MAIN" ? "main" : null;
  }, ARTICLE_H1);
  return { ok: target !== null, detail: target ? `focus on ${target}` : `after navigating, focus is on ${await describeFocus(page)}` };
});

keyboardCheck("route-announce", "reader-article", "desktop", async (page) => {
  await navigateWithTreeLink(page, "wiki/timeline", "Timeline");
  const announcer = page.locator('[data-test-id="route-announcer"]');
  const announced = await expect.poll(() => announcer.textContent().catch(() => null), { timeout: 3_000 })
    .toContain("Loaded Timeline").then(() => true, () => false);
  if (!announced) {
    const count = await announcer.count();
    return { ok: false, detail: count ? `route announcer reads "${(await announcer.first().textContent())?.trim()}"` : "no [data-test-id=route-announcer]" };
  }
  const live = await announcer.getAttribute("aria-live");
  return { ok: live === "polite", detail: `route announcer has aria-live=${live}` };
});

/** The reader scrolls inside main.content-shell; public pages scroll the document. */
const scrollTopOf = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("main");
  return main && main.scrollHeight > main.clientHeight + 1 ? main.scrollTop : (document.scrollingElement?.scrollTop ?? 0);
});

keyboardCheck("back-scroll-restore", "reader-big-tables", "desktop", async (page) => {
  const wanted = 1500;
  await page.evaluate((top) => {
    const main = document.querySelector("main");
    const scroller = main && main.scrollHeight > main.clientHeight + 1 ? main : document.scrollingElement;
    scroller?.scrollTo({ top, behavior: "instant" });
  }, wanted);
  await settle(page, 300);
  const before = await scrollTopOf(page);
  await navigateWithTreeLink(page, "wiki/timeline", "Timeline");
  await page.goBack();
  await expect(page.locator(ARTICLE_H1).filter({ visible: true })).toHaveText("Lab results");
  await settle(page, 800);
  const after = await scrollTopOf(page);
  return { ok: Math.abs(after - before) <= 40, detail: `scrolled to ${before}, after Back ${after}` };
});

// ---------------------------------------------------------------------------
// Overlays: Tab stays inside, Escape closes, focus returns to the opener.

type Overlay = { id: string; surface: string; viewport: ViewportName; opener: string; container: string };
const OVERLAYS: Overlay[] = [
  { id: "command-palette", surface: "reader-article", viewport: "desktop", opener: '[data-test-id="sidebar-search"]', container: '[data-test-id="command-palette"]' },
  { id: "actions-menu", surface: "reader-article", viewport: "desktop", opener: '[data-test-id="sidebar-workspace-trigger"]', container: '.wiki-shell-actions-popover[role="menu"]' },
  { id: "mobile-nav-sheet", surface: "reader-article", viewport: "mobile", opener: '[data-test-id="bottom-nav-trigger"]', container: '[data-test-id="bottom-nav-sheet"][role="dialog"]' },
  { id: "admin-create-role", surface: "admin-roles", viewport: "desktop", opener: 'main button:text-is("Create role")', container: '.admin-modal[role="dialog"]' },
  { id: "expanded-table", surface: "reader-article", viewport: "desktop", opener: 'main button[aria-label="Expand table"]', container: ".table-expansion-layer" },
];

async function openOverlay(page: Page, overlay: Overlay) {
  const opener = page.locator(overlay.opener).filter({ visible: true }).first();
  const container = page.locator(overlay.container).filter({ visible: true }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const opened = await container.waitFor({ timeout: 5_000 }).then(() => true, () => false);
  if (opened) await settle(page, 200);
  return { opener, container, opened };
}

for (const overlay of OVERLAYS) {
  keyboardCheck(`${overlay.id}-tab-trap`, overlay.surface, overlay.viewport, async (page) => {
    const { container, opened } = await openOverlay(page, overlay);
    if (!opened) return { ok: false, detail: "did not open with Enter on its control" };
    for (const [key, presses] of [["Tab", 15], ["Shift+Tab", 5]] as const) {
      for (let press = 1; press <= presses; press++) {
        await page.keyboard.press(key);
        if (!(await container.isVisible())) return { ok: false, detail: `closed after ${key} #${press}` };
        if (!(await focusInside(container))) return { ok: false, detail: `${key} #${press} moved focus outside to ${await describeFocus(page)}` };
      }
    }
    return { ok: true, detail: "focus stayed inside" };
  });

  keyboardCheck(`${overlay.id}-escape`, overlay.surface, overlay.viewport, async (page) => {
    const { container, opened } = await openOverlay(page, overlay);
    if (!opened) return { ok: false, detail: "did not open with Enter on its control" };
    await page.keyboard.press("Escape");
    const closed = await container.waitFor({ state: "hidden", timeout: 2_000 }).then(() => true, () => false);
    return { ok: closed, detail: closed ? "closed" : "still open after Escape" };
  });

  keyboardCheck(`${overlay.id}-focus-return`, overlay.surface, overlay.viewport, async (page) => {
    const { opener, container, opened } = await openOverlay(page, overlay);
    if (!opened) return { ok: false, detail: "did not open with Enter on its control" };
    await page.keyboard.press("Escape");
    const closed = await container.waitFor({ state: "hidden", timeout: 2_000 }).then(() => true, () => false);
    if (!closed) return { ok: false, detail: "still open after Escape" };
    await settle(page, 200);
    const returned = await opener.evaluate((element) => element === document.activeElement);
    return { ok: returned, detail: returned ? "focus returned" : `focus went to ${await describeFocus(page)}` };
  });
}

// ---------------------------------------------------------------------------
// Every focused element is visible.

for (const [surfaceId, viewport] of [["reader-article", "desktop"], ["reader-article", "mobile"], ["reader-private-denied", "desktop"]] as const) {
  keyboardCheck("focus-visible", surfaceId, viewport, async (page) => {
    const invisible = new Set<string>();
    for (let press = 0; press < 80; press++) {
      await page.keyboard.press("Tab");
      // Controls such as the sidebar collapse button fade in on :focus-visible; judge the end state.
      await finishTransitions(page);
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const store = window as unknown as { __surfaceSeen?: WeakSet<Element> };
        store.__surfaceSeen ??= new WeakSet();
        if (store.__surfaceSeen.has(element)) return { wrapped: true as const };
        store.__surfaceSeen.add(element);
        const path = (() => {
          const parts: string[] = [];
          for (let node: Element | null = element; node && parts.length < 3; node = node.parentElement) {
            parts.unshift(node.tagName.toLowerCase() + (node.id ? `#${node.id}` : ""));
          }
          return parts.join(">");
        })();
        const rect = element.getBoundingClientRect();
        let opacity = 1;
        let hidden = false;
        for (let node: Element | null = element; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          opacity *= Number(style.opacity);
          if (style.visibility === "hidden" || style.display === "none") hidden = true;
        }
        const onScreen = rect.width >= 1 && rect.height >= 1 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
        const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
        const name = `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} "${label}"`;
        return { wrapped: false as const, path, name, visible: !hidden && opacity >= 0.1 && onScreen, opacity: Number(opacity.toFixed(2)) };
      });
      if (!stop) continue;
      if (stop.wrapped) break;
      if (!stop.visible) invisible.add(`${stop.name} (opacity ${stop.opacity})`);
    }
    const list = [...invisible];
    return { ok: list.length === 0, value: list.length, detail: list.length ? `${list.length} invisible focus stops: ${list.slice(0, 6).join("; ")}${list.length > 6 ? "; ..." : ""}` : "all focus stops visible" };
  });
}

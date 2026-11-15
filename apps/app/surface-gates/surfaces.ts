/**
 * The surface registry: every page or overlay the surface gates capture. The visual,
 * accessibility and keyboard specs all iterate this one list, so adding a surface here
 * adds it to every gate.
 *
 * URLs point at the synthetic fixture vault (scripts/fixtures/local-stack-vault) that
 * `bun run local:stack` publishes. Marketing surfaces are served on oncobase.localhost.
 */
import type { Page } from "@playwright/test";

export type Auth = "public" | "gate" | "care" | "owner";
export type Theme = "light" | "dark";
export type ViewportName = "desktop" | "mobile";
export type Host = "diana" | "marketing";

export type Surface = {
  id: string;
  /** Path on the given host. */
  path: string;
  host?: Host;
  auth: Auth;
  /** Visible once the surface has rendered its real content (never the loading skeleton). */
  ready: string;
  viewports: ViewportName[];
  /** Pre-capture interaction that opens an overlay. */
  before?: (page: Page) => Promise<void>;
  /** Extra regions to mask in screenshots (content that legitimately changes between runs). */
  masks?: string[];
};

export const THEMES: Theme[] = ["light", "dark"];
export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const ARTICLE_H1 = '[data-test-id="document-article"] h1';
const both: ViewportName[] = ["desktop", "mobile"];
const desktop: ViewportName[] = ["desktop"];

async function openCommandPalette(page: Page) {
  await page.locator('[data-test-id="sidebar-search"]').click();
  await page.locator('[data-test-id="command-palette-input"]').waitFor();
  await page.keyboard.type("treatment");
  await page.locator('[data-test-id="command-palette"] [role="option"]').first().waitFor();
}

export const SURFACES: Surface[] = [
  { id: "landing", path: "/", auth: "public", ready: "h1", viewports: both },
  { id: "sign-in", path: "/sign-in", auth: "public", ready: '[data-test-id="sign-in-page"] input', viewports: both },
  { id: "reader-article", path: "/wiki/treatment", auth: "care", ready: ARTICLE_H1, viewports: both },
  // Fixture page added for this suite: long, with four wide tables.
  { id: "reader-big-tables", path: "/wiki/lab-results", auth: "care", ready: ARTICLE_H1, viewports: desktop },
  { id: "reader-private-denied", path: "/private/care-team-notes", auth: "gate", ready: '[data-reader-unavailable="true"]', viewports: desktop },
  { id: "file-palette", path: "/wiki/treatment", auth: "care", ready: ARTICLE_H1, viewports: desktop, before: openCommandPalette },
  {
    id: "actions-menu", path: "/wiki/treatment", auth: "care", ready: ARTICLE_H1, viewports: desktop,
    before: async (page) => {
      await page.locator('[data-test-id="sidebar-workspace-trigger"]').click();
      await page.locator('.wiki-shell-actions-popover[role="menu"]').waitFor();
    },
  },
  {
    id: "mobile-nav-sheet", path: "/wiki/treatment", auth: "care", ready: ARTICLE_H1, viewports: ["mobile"],
    before: async (page) => {
      await page.locator('[data-test-id="bottom-nav-trigger"]').filter({ visible: true }).first().click();
      await page.locator('[data-test-id="bottom-nav-sheet"][role="dialog"]').filter({ visible: true }).waitFor();
    },
  },
  // Text mode: AI mode answers from the stack's fake model and shows no results for this query.
  { id: "search", path: "/search?q=carboplatin&tab=text", auth: "care", ready: '[data-test-id="search-text-summary"]', viewports: both },
  { id: "chat", path: "/chat", auth: "care", ready: '[data-test-id="chat-composer-textarea"]', viewports: both },
  { id: "admin", path: "/admin", auth: "owner", ready: '[data-test-id="admin-stats"]', viewports: desktop },
  { id: "admin-roles", path: "/admin/roles", auth: "owner", ready: "main table", viewports: desktop },
  // The local stack has no diagnostic timeline, so this captures its "Timeline unavailable" state.
  { id: "diagnostics-timeline", path: "/diagnostics", auth: "care", ready: "main h1", viewports: both },
  { id: "diagnostics-imaging", path: "/diagnostics/imaging", auth: "care", ready: '[data-test-id="diagnostics-desktop-table"]', viewports: desktop },
  { id: "medical-deduction", path: "/tools/medical-deduction", auth: "care", ready: '[data-test-id="medical-deduction-summary"]', viewports: desktop },
  { id: "table-examples", path: "/table-examples", auth: "care", ready: "main table", viewports: desktop },
  // Comments are disabled on the local stack, so this is the disabled state.
  { id: "comments", path: "/comments", auth: "care", ready: '[data-test-id="comments-page"]', viewports: desktop },
  { id: "tag", path: "/tags/treatment", auth: "care", ready: '[data-test-id="tag-page"] a[href="/wiki/treatment"]', viewports: desktop },
  { id: "not-found", path: "/wiki/does-not-exist", auth: "care", ready: '[data-reader-unavailable="true"]', viewports: desktop },
  { id: "education", path: "/education", auth: "public", ready: '[data-test-id="education-app"] h1', viewports: both },
  { id: "marketing-home", host: "marketing", path: "/", auth: "public", ready: '[data-test-id="oncobase-home-page"] h1', viewports: both },
  { id: "marketing-features", host: "marketing", path: "/features", auth: "public", ready: '[data-test-id="features-page"] h1', viewports: desktop },
  { id: "marketing-compare", host: "marketing", path: "/compare", auth: "public", ready: '[data-test-id="compare-page"] h1', viewports: desktop },
];

/** Every surface x theme x viewport combination. */
export function surfaceCases() {
  return SURFACES.flatMap((surface) =>
    surface.viewports.flatMap((viewport) =>
      THEMES.map((theme) => ({ surface, theme, viewport, key: `${surface.id}.${theme}.${viewport}` })),
    ),
  );
}

export const surfaceById = (id: string) => {
  const surface = SURFACES.find((entry) => entry.id === id);
  if (!surface) throw new Error(`Unknown surface ${id}`);
  return surface;
};

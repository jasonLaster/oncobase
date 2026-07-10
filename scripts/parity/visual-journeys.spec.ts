import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

const DEFAULT_LEGACY_ORIGIN = "https://diana-tnbc.com";
const DEFAULT_VITE_ORIGIN = "https://wiki-vite-zeta.vercel.app";
const ORIGIN =
  process.env.PARITY_ORIGIN ||
  process.env.PARITY_VITE_ORIGIN ||
  process.env.PLAYWRIGHT_BASE_URL ||
  DEFAULT_VITE_ORIGIN;
const ORIGIN_LABEL = process.env.PARITY_ORIGIN_LABEL || inferOriginLabel(ORIGIN);
const OUTPUT_DIR =
  process.env.PARITY_JOURNEY_OUTPUT_DIR ||
  path.join("test-results", "parity-journeys", safeName(ORIGIN_LABEL));
const PASSWORD =
  process.env.PARITY_LOGIN_PASSWORD ||
  process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD ||
  "";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const;
const NAVIGATION_TIMEOUT_MS = 60_000;
const READY_TIMEOUT_MS = 45_000;
const SETTLE_MS = 750;
// Comma-separated checkpoint keys for focused reruns (empty = all).
const KEY_FILTER = (process.env.PARITY_JOURNEY_KEYS || "")
  .split(",")
  .map((key) => key.trim())
  .filter(Boolean);

type Viewport = typeof VIEWPORTS[number];
type CaptureMode = "fullPage" | "viewport";

type Checkpoint = {
  captureMode?: CaptureMode;
  key: string;
  masks?: (page: Page) => Locator[];
  run: (page: Page, viewport: Viewport) => Promise<void>;
  cleanup?: (page: Page) => Promise<void>;
  viewports?: readonly Viewport["name"][];
};

class SkipCheckpoint extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkipCheckpoint";
  }
}

function inferOriginLabel(origin: string) {
  if (origin === process.env.PARITY_LEGACY_ORIGIN || origin === DEFAULT_LEGACY_ORIGIN) {
    return "legacy";
  }
  if (origin === process.env.PARITY_VITE_ORIGIN || origin === DEFAULT_VITE_ORIGIN) {
    return "vite";
  }
  try {
    return new URL(origin).hostname.replace(/^www\./, "") || "origin";
  } catch {
    return "origin";
  }
}

function safeName(value: string) {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "checkpoint";
}

function cookieHeader() {
  const labelKey = ORIGIN_LABEL.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return (
    process.env.PARITY_ORIGIN_COOKIE_HEADER ||
    process.env[`PARITY_${labelKey}_COOKIE_HEADER`] ||
    process.env.PARITY_COOKIE_HEADER ||
    ""
  );
}

function vercelBypassHeaders() {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) return undefined;
  return {
    "x-vercel-protection-bypass": secret,
    "x-vercel-set-bypass-cookie": "true",
    "x-diana-test-auth": secret,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function login(page: Page, origin: string) {
  const header = cookieHeader();
  if (header) {
    await page.context().addCookies(
      header
        .split(/;\s*/)
        .map((part) => {
          const [name, ...valueParts] = part.split("=");
          return { name, value: valueParts.join("=") };
        })
        .filter(({ name, value }) => name && value)
        .map(({ name, value }) => ({
          name,
          value,
          url: origin,
          httpOnly: true,
          sameSite: "Lax" as const,
        })),
    );
    return;
  }

  if (!PASSWORD) return;
  const response = await page.request.post(new URL("/api/login", origin).toString(), {
    data: { password: PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`Login failed for ${origin}: ${response.status()} ${await response.text()}`);
  }
  const storage = await page.request.storageState();
  await page.context().addCookies(storage.cookies.filter((cookie) => cookie.domain));
}

async function openCapturePage(browser: Browser, origin: string, viewport: Viewport) {
  const context = await browser.newContext({
    baseURL: origin,
    extraHTTPHeaders: vercelBypassHeaders(),
    viewport,
  });
  const page = await context.newPage();
  await login(page, origin);
  return { context, page };
}

async function recoverIfSnagged(page: Page) {
  if ((await page.getByText("This reader hit a snag").count()) === 0) return false;
  const reset = page.getByRole("button", { name: "Reset local data & reload" });
  if (await reset.isVisible().catch(() => false)) {
    await reset.click();
  } else {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(5_000);
  return true;
}

async function settlePage(page: Page) {
  await page
    .getByText(/^Loading markdown for/)
    .waitFor({ state: "hidden", timeout: NAVIGATION_TIMEOUT_MS })
    .catch(() => {});
  await page
    .locator('[data-test-id="page-loading"], [data-test-id="markdown-body-loading"]')
    .first()
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}

async function gotoAndSettle(page: Page, pathname: string) {
  try {
    await page.goto(pathname, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });
  } catch (error) {
    throw new SkipCheckpoint(`navigation to ${pathname} failed: ${errorMessage(error)}`);
  }
  await settlePage(page);
  if (await recoverIfSnagged(page)) {
    try {
      await page.goto(pathname, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      throw new SkipCheckpoint(`navigation to ${pathname} after recovery failed: ${errorMessage(error)}`);
    }
    await settlePage(page);
  }
}

async function waitForAnyVisible(
  page: Page,
  locators: Locator[],
  description: string,
  timeout = READY_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const locator of locators) {
      const candidate = locator.first();
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    await page.waitForTimeout(250);
  }
  throw new SkipCheckpoint(`${description} was not visible within ${timeout}ms`);
}

async function waitForArticleHeading(page: Page, description = "article heading") {
  await waitForAnyVisible(
    page,
    [
      page.locator("article h1"),
      page.locator('[data-test-id="document-article"] h1'),
      page.locator(".page-header h1, .page-shell h1"),
    ],
    description,
  );
}

function alwaysMasks(page: Page) {
  return [
    page.locator(".metrics-panel, [data-test-id='metrics-panel']"),
    page.locator(".topbar-status, [data-test-id='topbar-status']"),
    page.locator(".page-footer, [data-test-id='page-footer']"),
    page.locator('[data-test-id*="dicom"] canvas, [data-testid*="dicom"] canvas'),
    page.locator('[data-test-id="dicom-annotation-canvas"]'),
    page.locator(
      '[data-test-id="chat-message-log"] time, [data-test-id*="timestamp"], [data-testid*="timestamp"], .chat-timestamp',
    ),
    page.locator(
      '[data-test-id="chat-interface"][data-chat-status="streaming"] [data-test-id="chat-message-log"]',
    ),
  ];
}

function dicomMasks(page: Page) {
  return [
    page.locator("canvas"),
    page.locator('[data-test-id="dicom-image-loading"]'),
    page.locator('[data-test-id$="-loading"]'),
  ];
}

async function captureCheckpoint(page: Page, checkpoint: Checkpoint, viewport: Viewport) {
  const basename = `${safeName(checkpoint.key)}-${viewport.name}`;
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `${basename}.png`),
    fullPage: checkpoint.captureMode !== "viewport",
    animations: "disabled",
    mask: [...alwaysMasks(page), ...(checkpoint.masks?.(page) ?? [])],
  });

  try {
    const text = await page.evaluate(() => {
      const root = (document.querySelector("main") as HTMLElement | null) ?? document.body;
      return root.innerText.replace(/\s+/g, " ").trim();
    });
    await writeFile(path.join(OUTPUT_DIR, `${basename}.txt`), text);
  } catch (error) {
    console.warn(`[visual-journeys] skipped text sidecar ${basename}: ${errorMessage(error)}`);
  }
}

async function closeOverlay(page: Page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
}

async function openCommandPalette(page: Page, chord: string, query?: string) {
  await gotoAndSettle(page, "/about/Thesis");
  await waitForArticleHeading(page, "content page heading for palette");
  const chords =
    chord.startsWith("Meta+")
      ? [chord, chord.replace(/^Meta\+/, "Control+")]
      : chord.startsWith("Control+")
        ? [chord, chord.replace(/^Control\+/, "Meta+")]
        : [chord];
  for (const candidate of chords) {
    await page.keyboard.press(candidate);
    await page.waitForTimeout(250);
    if (await page.getByTestId("command-palette").isVisible().catch(() => false)) break;
  }
  await waitForAnyVisible(page, [page.getByTestId("command-palette")], "command palette");
  if (query) {
    await page.waitForTimeout(150);
    await page.keyboard.press(query);
  }
  await waitForAnyVisible(page, [page.getByTestId("command-palette")], "command palette");
  await page.waitForTimeout(250);
}

function searchInput(page: Page) {
  return page
    .locator(
      [
        '[data-test-id="search-form-input"]',
        'input[aria-label="Search wiki"]',
        'input[aria-label="Search the wiki"]',
        'input[name="q"]',
      ].join(", "),
    )
    .first();
}

const checkpoints: Checkpoint[] = [
  {
    key: "content-page",
    run: async (page) => {
      await gotoAndSettle(page, "/about/Thesis");
      await waitForArticleHeading(page);
    },
  },
  {
    key: "index",
    run: async (page) => {
      await gotoAndSettle(page, "/");
      await waitForAnyVisible(
        page,
        [
          page.locator('[data-test-id="sidebar"], [data-test-id="wiki-sidebar"]'),
          page.locator('[data-test-id="sidebar-tree"], [data-test-id="bottom-nav-trigger"]'),
          page.locator('[data-test-id="document-article"], article'),
        ],
        "reader shell sidebar",
      );
    },
  },
  {
    key: "chat-new",
    run: async (page) => {
      await gotoAndSettle(page, "/chat");
      await waitForAnyVisible(
        page,
        [
          page.getByTestId("chat-composer-textarea"),
          page.getByTestId("chat-composer"),
          page.locator("textarea"),
        ],
        "chat composer",
      );
    },
  },
  {
    key: "chat-conversation",
    run: async (page, viewport) => {
      await gotoAndSettle(page, "/chat");
      await waitForAnyVisible(
        page,
        [page.getByTestId("conversation-list"), page.getByTestId("bottom-nav-trigger")],
        "conversation list",
      );

      let item = page.getByTestId("conversation-list-item").first();
      if (viewport.name === "mobile" && !(await item.isVisible().catch(() => false))) {
        const trigger = page.getByTestId("bottom-nav-trigger");
        if (await trigger.isVisible().catch(() => false)) {
          await trigger.click();
          await waitForAnyVisible(page, [page.getByTestId("bottom-nav-chat-list")], "mobile chat list");
          item = page
            .getByTestId("bottom-nav-chat-list")
            .getByTestId("conversation-list-item")
            .first();
        }
      }

      if (!(await item.isVisible().catch(() => false))) {
        throw new SkipCheckpoint("no conversation item was discoverable");
      }

      const conversationId = await item.getAttribute("data-conversation-id");
      if (conversationId) {
        await gotoAndSettle(page, `/chat/${encodeURIComponent(conversationId)}`);
      } else {
        await item.click();
        await settlePage(page);
      }
      await waitForAnyVisible(page, [page.getByTestId("chat-interface")], "chat conversation");
    },
  },
  {
    key: "chat-archived",
    run: async (page) => {
      await gotoAndSettle(page, "/chat/archived");
      await waitForAnyVisible(
        page,
        [page.getByTestId("chat-archived-page"), page.getByRole("heading", { name: /Archived Chats/i })],
        "archived chat page",
      );
    },
  },
  {
    key: "search-idle",
    run: async (page) => {
      await gotoAndSettle(page, "/search");
      await waitForAnyVisible(page, [searchInput(page), page.getByTestId("search-page")], "search input");
    },
  },
  {
    key: "search-results",
    run: async (page) => {
      await gotoAndSettle(page, "/search");
      const input = searchInput(page);
      await waitForAnyVisible(page, [input], "search input");
      await input.fill("diagnosis");
      await input.press("Enter");
      await waitForAnyVisible(
        page,
        [
          page.locator(
            '[data-test-id="search-results"] a, [data-test-id="search-text-result"], [data-test-id="search-ai-result"], .search-page-result',
          ),
        ],
        "search result rows",
        60_000,
      );
    },
  },
  {
    key: "diagnostics",
    run: async (page) => {
      await gotoAndSettle(page, "/diagnostics");
      await waitForAnyVisible(
        page,
        [
          page.locator('[data-test-id="diagnostic-timeline"] svg'),
          page.getByTestId("diagnostic-timeline"),
          page.getByTestId("mobile-diagnostic-timeline"),
        ],
        "diagnostic timeline",
        60_000,
      );
    },
  },
  {
    key: "diagnostics-imaging",
    run: async (page) => {
      await gotoAndSettle(page, "/diagnostics/imaging");
      await waitForAnyVisible(
        page,
        [page.getByTestId("diagnostics-desktop-table"), page.getByTestId("diagnostics-mobile-list")],
        "diagnostic imaging study list",
        60_000,
      );
    },
  },
  {
    key: "dicom-viewer",
    masks: dicomMasks,
    run: async (page) => {
      await gotoAndSettle(page, "/tools/dicom-viewer");
      await waitForAnyVisible(
        page,
        [page.getByTestId("dicom-cornerstone-viewport"), page.getByTestId("dicom-viewport-frame")],
        "DICOM cornerstone viewport",
        60_000,
      );
    },
  },
  {
    key: "dicom-compare",
    masks: dicomMasks,
    run: async (page) => {
      await gotoAndSettle(page, "/tools/dicom-compare");
      await waitForAnyVisible(page, [page.getByTestId("dicom-compare-left-viewport")], "left DICOM viewport", 60_000);
      await waitForAnyVisible(page, [page.getByTestId("dicom-compare-right-viewport")], "right DICOM viewport", 60_000);
    },
  },
  {
    key: "comments",
    run: async (page) => {
      await gotoAndSettle(page, "/comments");
      await waitForAnyVisible(
        page,
        [page.getByTestId("comments-page"), page.getByRole("heading", { name: "Comments" })],
        "comments page",
        60_000,
      );
    },
  },
  {
    key: "tag-page",
    run: async (page) => {
      await gotoAndSettle(page, "/tags/logistics");
      await waitForAnyVisible(
        page,
        [
          page.getByTestId("tag-page").locator("li, a"),
          page.locator(".tag-tree-root, article h1"),
          page.getByRole("heading", { name: /Tag: logistics/i }),
        ],
        "tag page list",
        60_000,
      );
    },
  },
  {
    key: "medical-deduction",
    run: async (page) => {
      await gotoAndSettle(page, "/tools/medical-deduction");
      await waitForAnyVisible(
        page,
        [
          page.getByTestId("medical-deduction-page").locator("input").first(),
          page.locator(".medical-deduction-shell input").first(),
          page.locator("input").first(),
        ],
        "medical deduction input",
      );
    },
  },
  {
    key: "admin",
    run: async (page) => {
      await gotoAndSettle(page, "/access");
      try {
        await waitForAnyVisible(
          page,
          [
            page.getByRole("heading", { name: /Admin|Users|Pages|Roles/i }),
            page.locator("table"),
            page.locator("aside[aria-label='Admin'], .admin-main"),
          ],
          "admin surface",
          20_000,
        );
      } catch {
        await gotoAndSettle(page, "/admin");
        await waitForAnyVisible(
          page,
          [
            page.getByRole("heading", { name: /Admin|Users|Pages|Roles/i }),
            page.locator("table"),
            page.locator("aside[aria-label='Admin'], .admin-main"),
          ],
          "admin surface",
          30_000,
        );
      }
    },
  },
  {
    captureMode: "viewport",
    cleanup: closeOverlay,
    key: "command-palette",
    run: async (page) => {
      await openCommandPalette(page, "Meta+K", "f");
    },
  },
  {
    captureMode: "viewport",
    cleanup: closeOverlay,
    key: "outline-palette",
    run: async (page) => {
      await openCommandPalette(page, "Meta+Shift+O");
    },
  },
  {
    captureMode: "viewport",
    cleanup: closeOverlay,
    key: "action-palette",
    run: async (page) => {
      await openCommandPalette(page, "Meta+Shift+K");
    },
  },
  {
    key: "sidebar-collapsed",
    run: async (page) => {
      await gotoAndSettle(page, "/about/Thesis");
      await waitForArticleHeading(page, "content page heading for sidebar collapse");
      const collapse = page.getByRole("button", { name: "Collapse sidebar" });
      await waitForAnyVisible(page, [collapse], "collapse sidebar button");
      await collapse.click();
      await waitForAnyVisible(
        page,
        [page.getByRole("button", { name: "Expand sidebar" }), page.locator('[data-sidebar-state="collapsed"]')],
        "collapsed sidebar state",
      );
      await page.waitForTimeout(250);
    },
    viewports: ["desktop"],
  },
  {
    captureMode: "viewport",
    cleanup: closeOverlay,
    key: "mobile-bottom-nav",
    run: async (page) => {
      await gotoAndSettle(page, "/about/Thesis");
      await waitForArticleHeading(page, "content page heading for bottom nav");
      const trigger = page.getByTestId("bottom-nav-trigger");
      await waitForAnyVisible(page, [trigger], "mobile bottom nav trigger");
      await trigger.click();
      await waitForAnyVisible(
        page,
        [
          page.locator('[data-test-id="bottom-nav-sheet"].open'),
          page.locator('[data-test-id="bottom-nav-sheet"][role="dialog"]'),
        ],
        "mobile bottom nav sheet",
      );
      await page.waitForTimeout(250);
    },
    viewports: ["mobile"],
  },
];

test("captures app-route visual journey checkpoints", async ({ browser }) => {
  await mkdir(OUTPUT_DIR, { recursive: true });
  console.log(`[visual-journeys] origin=${ORIGIN} label=${ORIGIN_LABEL} output=${OUTPUT_DIR}`);

  for (const viewport of VIEWPORTS) {
    const session = await openCapturePage(browser, ORIGIN, viewport);
    try {
      for (const checkpoint of checkpoints) {
        if (checkpoint.viewports && !checkpoint.viewports.includes(viewport.name)) continue;
        if (KEY_FILTER.length > 0 && !KEY_FILTER.includes(checkpoint.key)) continue;
        try {
          await checkpoint.run(session.page, viewport);
          await captureCheckpoint(session.page, checkpoint, viewport);
          console.log(`[visual-journeys] captured ${checkpoint.key}-${viewport.name}`);
        } catch (error) {
          console.warn(
            `[visual-journeys] skipped ${checkpoint.key}-${viewport.name}: ${errorMessage(error)}`,
          );
        } finally {
          await checkpoint.cleanup?.(session.page).catch(() => {});
        }
      }
    } finally {
      await session.context.close();
    }
  }
});

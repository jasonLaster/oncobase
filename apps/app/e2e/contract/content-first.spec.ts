import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { GATE_PASSWORD, requireLocalStack } from "./helpers";

// Content first (P1, P2, P5, P18) on the built reader and the real app shell:
// the document carries the page (and, signed in, the session answer) and a
// navigation slice, the article and tree paint before the store half
// (Effect, LiveStore, SQLite) arrives, and a reader without its persistent
// store records why. Needs the standalone server, which runs the shell; the
// Vite dev server does not:
//
//   bun run local:stack up --build && bun run local:stack serve
//   PLAYWRIGHT_BASE_URL=http://127.0.0.1:62110 bun run local:stack exec -- \
//     bunx playwright test e2e/contract/content-first.spec.ts
//
// Seeded fixture: care@local.test (care team) may read private/care-team-notes;
// reader@local.test (no role) may not.
requireLocalStack();
test.skip(!process.env.PLAYWRIGHT_BASE_URL, "Requires the standalone server (the app shell inlines the payload).");

const CARE = { email: "care@local.test", password: "local-care-password" };
const READER = { email: "reader@local.test", password: "local-reader-password" };
const SENSITIVE = "private/care-team-notes";
const SENSITIVE_TEXT = "Next oncology visit";
const SENSITIVE_SLUGS = ["private/care-team-notes", "private/family-contacts", "private/lab-report"];
const PUBLIC = "wiki/biomarkers/her2-low";

async function signIn(request: APIRequestContext, user?: { email: string; password: string }) {
  const gate = await request.post("/api/login", { data: { password: GATE_PASSWORD } });
  expect(gate.ok(), await gate.text()).toBeTruthy();
  if (!user) return;
  const response = await request.post("/api/auth/signin", { data: user });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Hold the store half (and optionally more) until released. */
async function holdStore(page: Page, extra?: RegExp) {
  const held: Route[] = [];
  let open = false;
  const pattern = extra ? new RegExp(`/assets/StoreHost-[\\w-]+\\.js$|${extra.source}`) : /\/assets\/StoreHost-[\w-]+\.js$/;
  await page.route(pattern, route => { if (open) return route.continue(); held.push(route); });
  return async () => { open = true; await Promise.all(held.splice(0).map(route => route.continue())); };
}

function documentPayload(html: string, id: "wiki-page-bootstrap" | "wiki-navigation-bootstrap") {
  const raw = html.match(new RegExp(`<script id="${id}" type="application/json">(.*?)</script>`, "s"))?.[1];
  return raw ? JSON.parse(raw) as Record<string, unknown> : null;
}

function treeSlugs(nodes: unknown[], parent = ""): string[] {
  return nodes.flatMap(node => {
    const [type, name, children] = node as [string, string, unknown[] | undefined];
    const slug = parent ? `${parent}/${name}` : name;
    return type === "d" ? [slug, ...treeSlugs(children ?? [], slug)] : [slug];
  });
}

test.describe("the article paints before the store", () => {
  test("signed in: a restricted page paints from the document, then the store attaches", async ({ page }) => {
    await signIn(page.request, CARE);
    const release = await holdStore(page);
    const reads: string[] = [];
    page.on("request", request => { const { pathname } = new URL(request.url()); if (/^\/api\/wiki\/(session|pages)$/.test(pathname)) reads.push(pathname); });
    await page.goto(`/${SENSITIVE}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".wiki-markdown")).toContainText(SENSITIVE_TEXT);
    await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "false");
    // The document carried the session answer and the page: nothing asked again.
    expect(reads).toEqual([]);
    await release();
    await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "true", { timeout: 30_000 });
    await expect(page.locator(".wiki-markdown")).toContainText(SENSITIVE_TEXT);
  });

  test("gated (password only): a public page paints from the document before the store", async ({ page }) => {
    await signIn(page.request);
    const release = await holdStore(page);
    const pageReads: string[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/wiki/pages") pageReads.push(request.url()); });
    await page.goto(`/${PUBLIC}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".wiki-markdown p").first()).toBeVisible();
    await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "false");
    expect(pageReads).toEqual([]);
    await release();
    await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "true", { timeout: 30_000 });
  });
});

test.describe("the inlined payload is the API's answer for the same request", () => {
  test("a user without access gets no restricted page, content or slugs in the document", async ({ page }) => {
    await signIn(page.request, READER);
    const response = await page.request.get(`/${SENSITIVE}`, { headers: { Accept: "text/html" } });
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    const html = await response.text();
    expect(html).not.toContain(SENSITIVE_TEXT);
    expect(documentPayload(html, "wiki-page-bootstrap")).toBeNull();
    // A public page for the same user: its slice lists nothing the user's own manifest does not.
    const publicHtml = await (await page.request.get(`/${PUBLIC}`, { headers: { Accept: "text/html" } })).text();
    const payload = documentPayload(publicHtml, "wiki-page-bootstrap");
    const navigation = documentPayload(publicHtml, "wiki-navigation-bootstrap");
    expect(payload).toMatchObject({ version: 2, scope: "session" });
    expect(navigation).toMatchObject({ scope: "session" });
    const sliceSlugs = treeSlugs(navigation!.tree as unknown[]);
    for (const slug of SENSITIVE_SLUGS) {
      expect(publicHtml).not.toContain(slug);
      expect(sliceSlugs).not.toContain(slug);
    }
    const manifest = await (await page.request.get("/api/wiki/manifest?scope=session&format=compact-v1")).json() as { compactTree: unknown[] };
    const allowed = new Set(treeSlugs(manifest.compactTree));
    expect(sliceSlugs.filter(slug => !allowed.has(slug))).toEqual([]);
  });

  test("a care-team document carries exactly what the session and page APIs return to it", async ({ page }) => {
    await signIn(page.request, CARE);
    const html = await (await page.request.get(`/${SENSITIVE}`, { headers: { Accept: "text/html" } })).text();
    const payload = documentPayload(html, "wiki-page-bootstrap") as { identity: unknown; page: Record<string, unknown> } | null;
    expect(payload).toMatchObject({ version: 2, scope: "session", pathname: `/${SENSITIVE}` });
    const session = await (await page.request.get("/api/wiki/session?scope=session")).json();
    const pages = await (await page.request.get(`/api/wiki/pages?scope=session&slugs=${encodeURIComponent(SENSITIVE)}`)).json() as { pages: Array<Record<string, unknown>> };
    expect(payload!.identity).toEqual(session);
    const api = pages.pages.find(item => item.slug === SENSITIVE)!;
    for (const field of ["slug", "title", "content", "contentHash", "sensitive", "tags"]) expect(payload!.page[field], field).toEqual(api[field]);
    expect(html).toContain('data-reader-payload="session"');
  });

  test("an explicit public scope never receives the session payload", async ({ page }) => {
    await signIn(page.request, CARE);
    const html = await (await page.request.get(`/${PUBLIC}?scope=public`, { headers: { Accept: "text/html" } })).text();
    expect(documentPayload(html, "wiki-page-bootstrap")).toMatchObject({ version: 1, scope: "public" });
  });
});

test("the tree's first paint comes from the inlined navigation slice", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page.request, CARE);
  const release = await holdStore(page, /\/api\/wiki\/manifest/);
  await page.goto(`/${PUBLIC}`, { waitUntil: "domcontentloaded" });
  const sidebar = page.getByTestId("wiki-sidebar");
  // Top level, then the current page's ancestors and their children.
  await expect(sidebar.locator("[data-tree-row]").first()).toBeVisible();
  await expect(sidebar.getByRole("link", { name: /her2/i })).toBeVisible();
  await expect(sidebar.getByText(/biomarkers/i).first()).toBeVisible();
  await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "false");
  await release();
  await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "true", { timeout: 30_000 });
  // The full manifest then fills in folders the slice left closed.
  await expect(sidebar.locator("[data-tree-row]").first()).toBeVisible();
});

test.describe("a reader without its persistent store records why", () => {
  for (const { label, path, setup, reason } of [
    { label: "a diagnostic memory request", path: `/${PUBLIC}?paintDebug=1&readerStorage=memory`, setup: null, reason: "storage-diagnostic" },
    { label: "denied storage", path: `/${PUBLIC}`, reason: "storage-denied",
      setup: () => { Object.defineProperty(navigator.storage, "getDirectory", { value: () => Promise.reject(new DOMException("denied", "SecurityError")) }); } },
  ] as const) {
    test(label, async ({ page }) => {
      await signIn(page.request);
      if (setup) await page.addInitScript(setup);
      const spans: Array<{ name: string; reason?: string }> = [];
      await page.route("**/api/wiki/telemetry", async route => {
        try { spans.push(...(route.request().postDataJSON() as { spans: typeof spans }).spans); } catch { /* sendBeacon bodies are optional here */ }
        await route.fulfill({ status: 204 });
      });
      await page.goto(path);
      await expect(page.locator(".prototype-shell")).toHaveAttribute("data-reader-store-ready", "true", { timeout: 30_000 });
      await expect(page.locator("html")).toHaveAttribute("data-reader-store-fallback", reason);
      await expect.poll(() => spans.find(span => span.name === "store-fallback")?.reason, { timeout: 10_000 }).toBe(reason);
      expect(spans.find(span => span.name === "storage-ready")?.reason).toBe(reason);
    });
  }
});

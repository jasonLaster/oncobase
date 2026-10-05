import { expect, test } from "@playwright/test";
import { CARE, openPage, passGate, requireLocalStack } from "./helpers";
import { createFixtureSite, gatedContext, piiDocument, RAW_IDENTIFIERS } from "../contract/helpers";

// Identifiers are redacted at the API boundary, so no route, query string or
// tool the reader offers can reveal them. Real backend: a page seeded with the
// default site's identifiers is read through the actual reader.
requireLocalStack();

const fixtures = createFixtureSite();
const pii = piiDocument(fixtures.nonce);
const PAGE_PATH = `/${pii.slug}`;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(150_000);
  await fixtures.document(pii);
  // The server keeps the search corpus for up to a minute; wait until the
  // seeded page is searchable so the search journey below is deterministic.
  const reader = await gatedContext(baseURL!);
  try {
    await expect
      .poll(async () => JSON.stringify(await (await reader.get(`/api/search?q=piimark${fixtures.nonce}&limit=5`)).json()), {
        timeout: 100_000,
        intervals: [2_000],
      })
      .toContain(pii.slug);
  } finally {
    await reader.dispose();
  }
});
test.afterAll(() => fixtures.dispose());

test.beforeEach(async ({ page }) => passGate(page));

test("a rendered page redacts identifiers, and showPII does not reveal them", async ({ page }) => {
  for (const query of ["", "?showPII=1", "?showPII=true"]) {
    await openPage(page, `${PAGE_PATH}${query}`, pii.title);
    await expect(page.locator("article").filter({ visible: true }).first(), `page${query}`).toContainText("[redacted MRN]");
    await expect(page.locator("body"), `page${query}`).not.toContainText(RAW_IDENTIFIERS);
  }
});

test("text search finds the redacted line and never matches a raw identifier", async ({ page }) => {
  const search = async (query: string) => {
    await page.goto(`/search?q=${encodeURIComponent(query)}`);
    await page.getByRole("button", { name: "Text Search" }).click();
    await expect(page.getByTestId("search-text-summary").or(page.getByTestId("search-text-empty"))).toBeVisible();
  };

  await search(`piimark${fixtures.nonce}`);
  const hit = page.getByTestId("search-text-result").filter({ hasText: fixtures.nonce });
  await expect(hit).toBeVisible();
  await expect(hit).toContainText("[redacted MRN]");
  await expect(page.getByTestId("search-results")).not.toContainText(RAW_IDENTIFIERS);

  // The raw name and MRN are not in the searchable corpus at all.
  for (const raw of ["Diana Laster", "88855655"]) {
    await search(raw);
    await expect(page.getByTestId("search-text-empty"), raw).toBeVisible();
    await expect(page.getByTestId("search-text-result").filter({ hasText: fixtures.nonce }), raw).toHaveCount(0);
  }
});

test("copying or downloading the page as markdown stays redacted, even with showPII", async ({ page }) => {
  await openPage(page, `${PAGE_PATH}?showPII=1`, pii.title);
  await page.getByRole("button", { name: "Copy page as markdown" }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("[redacted MRN]");
  expect(await page.evaluate(() => navigator.clipboard.readText())).not.toMatch(RAW_IDENTIFIERS);

  // The download endpoint the app links to answers from the same redacted source.
  const download = await page.evaluate(async (slug) => {
    const response = await fetch(`/api/page-copy?slug=${encodeURIComponent(slug)}&showPII=1`);
    return { status: response.status, text: await response.text() };
  }, pii.slug);
  expect(download.status).toBe(200);
  expect(download.text).toContain("[redacted MRN]");
  expect(download.text).not.toMatch(RAW_IDENTIFIERS);
});

test("the raw-markdown route is not available to the gate, or to a signed-in non-admin", async ({ page }) => {
  const expectUnavailable = async (label: string) => {
    await page.goto(`/pii-view/${pii.slug}`);
    await expect(page.locator("article").filter({ visible: true }).first(), label).toContainText("Page not found");
    await expect(page, label).toHaveURL(/\/pii-view\//);
    await expect(page.locator("body"), label).not.toContainText(RAW_IDENTIFIERS);
    await expect(page.locator("body"), label).not.toContainText("redacted MRN");
  };

  await expectUnavailable("gate only");
  // The care team can read sensitive pages, but raw identifiers are admin-only.
  const signIn = await page.request.post("/api/auth/signin", { data: CARE });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  await expectUnavailable("care team");
});

test("the raw-markdown route shows identifiers to the site admin", async ({ page }) => {
  const signIn = await page.request.post("/api/auth/signin", {
    data: {
      email: process.env.LOCAL_STACK_ADMIN_EMAIL ?? "owner@local.test",
      password: process.env.LOCAL_STACK_ADMIN_PASSWORD ?? "local-admin-password",
    },
  });
  expect(signIn.ok(), await signIn.text()).toBeTruthy();
  await page.goto(`/pii-view/${pii.slug}`);
  await expect(page.locator("article").filter({ visible: true }).first()).not.toContainText("Page not found");
  await expect(page.locator("body")).toContainText(RAW_IDENTIFIERS);
});

import { expect } from "@playwright/test";
import { test } from "./persistent-reader-fixture";
import { documentArticle, gotoWiki, installWikiApiMocks } from "./fixtures";

for (const storedScope of [null, "public"] as const) {
  test(`signed-in reader opens a restricted deep link with ${storedScope ?? "no"} saved scope`, async ({ page }) => {
    await page.addInitScript((scope) => {
      if (scope) localStorage.setItem("wiki-vite-scope", scope);
      else localStorage.removeItem("wiki-vite-scope");
    }, storedScope);
    const requests = await installWikiApiMocks(page, { sessionAuthenticated: true });
    await gotoWiki(page, "/private/plan");
    await expect(documentArticle(page)).toContainText("Sensitive session-only planning note.");
    expect(requests.sessionIdentities.some(url => new URL(url).searchParams.get("scope") === "session")).toBe(true);
    expect(requests.manifest.some(url => new URL(url).searchParams.get("scope") === "session")).toBe(true);
    expect(new URL(page.url()).searchParams.has("scope")).toBe(false);
  });
}

test("explicit public view excludes restricted content even when signed in", async ({ page }) => {
  const requests = await installWikiApiMocks(page, { sessionAuthenticated: true });
  await page.goto("/private/plan?scope=public");
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  await expect(documentArticle(page)).not.toContainText("Sensitive session-only planning note.");
  expect(requests.sessionIdentities.every(url => new URL(url).searchParams.get("scope") === "public")).toBe(true);
});

test("signed-out readers fall back to public without retaining session access", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wiki-vite-scope", "session"));
  const requests = await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  await expect(documentArticle(page)).toContainText("Insurance");
  expect(requests.manifest.every(url => new URL(url).searchParams.get("scope") === "public")).toBe(true);
  await page.goto("/private/plan");
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
});

test("a warm public cache switches to the current account's separate session cache", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  requests.setSessionAuthenticated(true);
  await gotoWiki(page, "/private/plan");
  await expect(documentArticle(page)).toContainText("Sensitive session-only planning note.");
  requests.setSessionAuthenticated(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  await expect(documentArticle(page)).not.toContainText("Sensitive session-only planning note.");
});

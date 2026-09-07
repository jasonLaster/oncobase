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
  await expect(page.getByRole("heading", { name: "This page may be restricted", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "This page may be restricted", exact: true })).toBeVisible();
});

test("a warm public cache switches to the current account's separate session cache", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  await gotoWiki(page, "/wiki/logistics/insurance");
  requests.setSessionAuthenticated(true);
  await gotoWiki(page, "/private/plan");
  await expect(documentArticle(page)).toContainText("Sensitive session-only planning note.");
  requests.setSessionAuthenticated(false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "This page may be restricted", exact: true })).toBeVisible();
  await expect(documentArticle(page)).not.toContainText("Sensitive session-only planning note.");
});


test("a cached public denial stays a loader until delayed identity verification finishes", async ({ page }) => {
  const requests = await installWikiApiMocks(page);
  await gotoWiki(page, "/private/plan");
  await expect(page.getByRole("heading", { name: "This page may be restricted" })).toBeVisible();
  requests.setSessionAuthenticated(true);
  let releaseIdentity!: () => void;
  const identityGate = new Promise<void>(resolve => { releaseIdentity = resolve; });
  await page.route("**/api/wiki/session**", async route => {
    await identityGate;
    await route.fallback();
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  try {
    await expect(page.getByTestId("sidebar-search")).toBeVisible();
    await expect(page.getByTestId("page-loading")).toBeVisible();
    await expect(page.getByRole("heading", { name: /restricted|not found|no longer available/i })).toHaveCount(0);
  } finally {
    releaseIdentity();
  }
  await expect(documentArticle(page)).toContainText("Sensitive session-only planning note.");
});

test("public unavailable pages offer sign-in with the original destination and without forcing public scope", async ({ page }) => {
  await installWikiApiMocks(page);
  await gotoWiki(page, "/private/plan?scope=public&from=call#notes");
  await expect(page.getByRole("heading", { name: "This page may be restricted" })).toBeVisible();
  const signIn = documentArticle(page).getByRole("link", { name: "Sign in", exact: true });
  await expect(signIn).toHaveAttribute("href", `/login?redirect=${encodeURIComponent("/private/plan?from=call#notes")}`);
  await expect(documentArticle(page)).not.toContainText("Sensitive session-only planning note.");
});

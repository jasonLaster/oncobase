import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";

async function prepare(page: Page, info: TestInfo, strict = false) {
  const { mode, theme } = info.project.metadata;
  await page.goto(`/?mode=${mode}&theme=${theme}&strict=${strict}`);
  const trigger = page.getByRole("button", { name: "Open image: Focus fixture", exact: true }).filter({ visible: true });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await info.attach("fixture-context", {
    body: JSON.stringify({
      mode, theme, strict,
      browserVersion: page.context().browser()?.version(),
      actual: await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        scheme: getComputedStyle(document.documentElement).colorScheme,
      })),
    }), contentType: "application/json",
  });
  return trigger;
}

test("Enter then Escape restores the exact trigger and allows keyboard reopening", async ({ page }, info) => {
  const trigger = await prepare(page, info);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await info.attach(`escape-focus-${cycle}`, {
      body: JSON.stringify(await page.evaluate(() => ({
        activeTag: document.activeElement?.tagName,
        activeLabel: document.activeElement?.getAttribute("aria-label"),
        openDialogs: document.querySelectorAll("dialog[open]").length,
      }))), contentType: "application/json",
    });
    await expect(trigger).toBeFocused();
  }
});

test("visible Close restores the exact keyboard opener", async ({ page }, info) => {
  const trigger = await prepare(page, info);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await info.attach("visible-close-focus", {
    body: JSON.stringify(await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName,
      activeLabel: document.activeElement?.getAttribute("aria-label"),
      openDialogs: document.querySelectorAll("dialog[open]").length,
    }))), contentType: "application/json",
  });
  await expect(trigger).toBeFocused();
});

test("keyboard Close restores focus", async ({ page }, info) => {
  const trigger = await prepare(page, info);
  await page.keyboard.press("Enter");
  const close = page.getByRole("button", { name: "Close image preview", exact: true });
  await close.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Space opening and scrim dismissal restore focus without moving the page", async ({ page }, info) => {
  const trigger = await prepare(page, info);
  const before = await page.evaluate(() => scrollY);
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss image preview", exact: true }).click({ position: { x: 8, y: 200 } });
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(before);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("auto");
});

for (const operation of ["remove", "replace"] as const) {
  test(`${operation}d trigger is not focused or guessed by identity on close`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await prepare(page, info);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.evaluate(operation => window.focusFixture[operation](), operation);
    if (info.project.metadata.mode === "delegated") {
      await page.getByRole("button", { name: "Close image preview", exact: true }).click();
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("body")).toBeFocused();
    const after = page.getByRole("button", { name: "Continue reading", exact: true });
    await after.focus();
    await expect(after).toBeFocused();
    expect(errors).toEqual([]);
  });
}

test("StrictMode cleanup and repeated reopening preserve focus and body overflow", async ({ page }, info) => {
  const trigger = await prepare(page, info, true);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss image preview", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("auto");
  }
});

test("closing does not steal focus from a newer connected reading control", async ({ page }, info) => {
  await prepare(page, info);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector("dialog")) {
        document.getElementById("after-viewer")?.focus();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Close image preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toBeFocused();
});

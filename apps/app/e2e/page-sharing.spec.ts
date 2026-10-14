import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { gotoWiki, installWikiApiMocks } from "./fixtures";

const token = "s".repeat(43);
const shared = { slug: "private/plan", title: "Private Plan", content: "# Private Plan\n\nThis is the shared page.\n\n[Details](#details)\n\n## Details\n\nOnly this page is shared.\n\n[Other private page](/private/other)\n\n[Report](report.pdf)\n\n![Chart](chart.png)" };

for (const { width, theme } of [{ width: 393, theme: "light" }, { width: 1440, theme: "light" }, { width: 393, theme: "dark" }, { width: 1440, theme: "dark" }]) {
  test(`lock sharing flow and isolated recipient at ${width}px in ${theme} theme`, async ({ page, context, browserName }) => {
    await context.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await installWikiApiMocks(page, { sessionAuthenticated: true });
    let active = false;
    await context.route("**/api/page-shares**", route => {
      const req = route.request(); const pathname = new URL(req.url()).pathname;
      if (pathname.endsWith("/read")) return route.fulfill({ status: active ? 200 : 404, json: active ? shared : { error: "Link unavailable" } });
      if (pathname.endsWith("/asset")) {
        if (req.postDataJSON().path.endsWith(".png")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZsAAAAASUVORK5CYII=", "base64") });
        return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\nsynthetic" });
      }
      if (req.method() === "POST") active = true;
      if (req.method() === "DELETE") active = false;
      return route.fulfill({ json: { active, ...(req.method() === "POST" ? { url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "61001"}/share#${token}` } : {}) } });
    });
    await gotoWiki(page, "/private/plan?scope=session");
    const lock = page.getByRole("button", { name: "Share private page", exact: true });
    await lock.click();
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
    await expect(dialog.getByText("No active link.", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Create link", exact: true }).click();
    await expect(dialog.getByLabel("Secure link", { exact: true })).toHaveValue(new RegExp(`/share#${token}$`));
    await dialog.getByRole("button", { name: "Copy link" }).click();
    await expect(dialog.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Replace link", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Revoke link", exact: true })).toBeVisible();
    await expect(dialog.getByRole("combobox")).toHaveCount(0);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const result = await (window as typeof window & { axe: typeof axe }).axe.run(document.querySelector("dialog")!, { runOnly: ["wcag2a", "wcag2aa"] });
      return result.violations.map(v => v.id);
    });
    expect(violations).toEqual([]);
    const bounds = await dialog.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.playwright/page-sharing/dialog-${width}-${theme}.png` });
    await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible(); await expect(lock).toBeFocused();

    const recipient = await context.newPage(); await recipient.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    const readerRequests: string[] = [];
    recipient.on("request", req => { if (/\/api\/(wiki|auth|search|liveblocks|chat)/.test(req.url())) readerRequests.push(req.url()); });
    await recipient.goto(`/share#${token}`);
    await expect(recipient.getByTestId("shared-article")).toContainText("Only this page is shared.");
    await expect(recipient.getByRole("note", { name: "Private page" })).toContainText("Only people with this secure URL can access this shared view.");
    await expect(recipient.locator("h1")).toHaveCount(1);
    await expect(recipient.getByRole("navigation")).toHaveCount(0);
    await expect(recipient.locator("img[alt='Chart']")).toHaveAttribute("src", /^blob:/);
    await recipient.getByRole("link", { name: "Details", exact: true }).click();
    expect(new URL(recipient.url()).hash).toBe(`#${token}`);
    const download = recipient.waitForEvent("download"); await recipient.getByRole("button", { name: "Report", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("report.pdf");
    expect(readerRequests).toEqual([]);
    await recipient.screenshot({ path: `.playwright/page-sharing/recipient-${width}-${theme}.png` });
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Share private page" }).click();
    await page.getByRole("button", { name: "Revoke link" }).click();
    await expect(page.getByRole("dialog").getByText("No active link.", { exact: true })).toBeVisible();
    await recipient.reload(); await expect(recipient.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
    await recipient.close();
  });
}

test("readers without sharing permission see an explanation and no create action", async ({ page }) => {
  await installWikiApiMocks(page, { sessionAuthenticated: true });
  await page.route("**/api/page-shares**", route => route.fulfill({ status: 403, json: { error: "Only the site owner or an admin can share this page." } }));
  await gotoWiki(page, "/private/plan?scope=session"); await page.getByRole("button", { name: "Share private page" }).click();
  await expect(page.getByRole("alert")).toContainText("Only the site owner or an admin");
  await expect(page.getByRole("button", { name: "Create link", exact: true })).toHaveCount(0);
});

test("changing the share link in an open tab discards the previous page", async ({ page }) => {
  await page.route("**/api/page-shares/read", route => route.fulfill({ json: { ...shared, content: 'Only this page is shared.\n\n<a href="#shared-file:%">Malformed file</a>' } }));
  await page.goto(`/share#${token}`);
  await expect(page.getByTestId("shared-article")).toBeVisible();
  await page.getByRole("link", { name: "Malformed file", exact: true }).click();
  await expect(page.getByTestId("shared-article")).toBeVisible();
  await page.evaluate(() => { location.hash = "incomplete"; });
  await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
  await expect(page.getByTestId("shared-article")).toHaveCount(0);
});

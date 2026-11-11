import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 700, height: 852 }, { width: 701, height: 852 }]) {
  test(`mobile chat keeps typing and voice controls usable at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/education/chat/");
    const welcome = page.locator(".session-chat-welcome");
    await expect(welcome).toBeVisible();
    expect(await welcome.evaluate(el => el.scrollTop)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const input = page.getByRole("textbox", { name: "Your question" });
    const talk = page.locator(".session-chat-input-row .edu-chat-talk");
    const inputBox = (await input.boundingBox())!;
    const talkBox = (await talk.boundingBox())!;
    const rowBox = (await page.locator(".session-chat-input-row").boundingBox())!;
    expect(inputBox.width).toBeGreaterThan(rowBox.width - 30);
    expect(talkBox.y).toBeGreaterThanOrEqual(inputBox.y + inputBox.height + 8);
    expect(talkBox.height).toBeGreaterThanOrEqual(44);
    const sendBox = (await page.getByRole("button", { name: "Ask", exact: true }).boundingBox())!;
    expect(sendBox.height).toBeGreaterThanOrEqual(44);
    expect(sendBox.width).toBeGreaterThanOrEqual(44);
    await input.fill("How does DNA repair work?");
    await input.press("Tab");
    await expect(talk).toBeFocused();
    await talk.press("Enter");
    await expect(page.getByRole("dialog", { name: "Talk with OncoGuide" })).toBeVisible();
  });
}

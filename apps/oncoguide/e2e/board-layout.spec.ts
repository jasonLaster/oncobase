import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import type { EducationVisualCatalog } from "@oncobase/education/visuals";
import { installFakeRealtime } from "./support/fake-realtime";
const catalog = JSON.parse(fs.readFileSync("out/visual-catalog.json", "utf8")) as EducationVisualCatalog;
const paired = catalog.visuals.filter(v => v.kind === "cartoon" && v.darkSrc);
const visual = paired.find(v => /CAR.*anatomy/i.test(v.pageTitle)) ?? paired[0]!;
const other = paired.find(v => v.slug !== visual.slug)!;
const emit = (page: Page, event: unknown) => page.evaluate(event => window.__talk.emit(event), event);
async function tool(page: Page, name: string, args: unknown, board = false) {
  await emit(page, { type: "response.done", response: { status: "completed", ...(board ? { metadata: { talk_purpose: "board" } } : {}), output: [{ type: "function_call", call_id: Math.random().toString(), name, arguments: JSON.stringify(args) }] } });
}
for (const width of [393, 700, 701, 1440, 1920]) test(`topic board updates without duplicate images or summaries at ${width}`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width < 800 ? 852 : 1000 });
  await page.addInitScript(installFakeRealtime);
  await page.route("**/api/education/talk", route => route.fulfill({ status: 200, contentType: "application/sdp", body: "v=0\r\nfake-answer\r\n" }));
  await page.goto("/education/chat/");
  await page.locator(".edu-chat-talk").click();
  await page.getByRole("button", { name: "Start talking", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__talk.sent.length >= 0 && window.__talk.peers)).toBe(1);
  await emit(page, { type: "session.created" });
  await expect(page.getByRole("status").filter({ hasText: "Listening" })).toBeVisible();
  await tool(page, "read_section", { section_id: visual.sectionId });
  const pictures = page.locator('.edu-talk-board-figure > img:visible');
  await expect(pictures).toHaveCount(1);
  await expect(pictures).toHaveAttribute("src", visual.src!);
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(pictures).toHaveCount(1);
  await expect(pictures).toHaveAttribute("src", visual.darkSrc!);
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(pictures).toHaveAttribute("src", visual.src!);
  await tool(page, "show_key_points", { title: "First explanation", points: ["A detail from this lesson"], source_section_id: visual.sectionId }, true);
  if (width <= 701) {
    await expect(page.locator('.edu-talk-context-body')).toBeHidden();
    await page.getByRole("button", { name: /What to notice/ }).click();
  }
  await expect(page.getByRole("heading", { name: "First explanation", exact: true })).toBeVisible();
  await tool(page, "show_steps", { title: "Follow the structure", steps: ["Start with the outside", "Follow the connection inside"], source_section_id: visual.sectionId }, true);
  await expect(page.getByRole("heading", { name: "Follow the structure", exact: true })).toBeVisible();
  await expect(page.locator('[data-card-kind="key_points"]')).toHaveCount(0);
  await expect(pictures).toHaveCount(1);
  await expect(page.locator('[data-card-kind="steps"]')).toHaveCount(1);
  if (process.env.ONCOGUIDE_BOARD_SHOTS) {
    fs.mkdirSync(process.env.ONCOGUIDE_BOARD_SHOTS, { recursive: true });
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "Dark theme", exact: true }).click();
      await pictures.evaluateAll(async imgs => { for (const img of imgs) await (img as HTMLImageElement).decode(); });
      await page.locator(".edu-talk-board-feed").evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: `${process.env.ONCOGUIDE_BOARD_SHOTS}/board-${width}-${theme}.png` });
    }
  }
  if (width >= 1440) {
    const a = (await page.locator('.edu-talk-board-figure').boundingBox())!;
    const b = (await page.locator('.edu-talk-topic-context').boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width + 23);
  }
  await emit(page, { type: "input_audio_buffer.speech_started" });
  await tool(page, "read_section", { section_id: other.sectionId });
  await expect(page.locator(".edu-talk-topic-title")).toHaveText(other.pageTitle);
  await page.getByRole('navigation', { name: 'Conversation topics' }).getByRole('button', { name: visual.pageTitle, exact: true }).click();
  await emit(page, { type: "input_audio_buffer.speech_started" });
  await tool(page, "read_section", { section_id: other.sectionId });
  await expect(page.locator('.edu-talk-topic-title')).toHaveText(visual.pageTitle);
  await page.getByRole('button', { name: 'Follow conversation', exact: true }).click();
  await expect(page.locator('.edu-talk-topic-title')).toHaveText(other.pageTitle);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'End talk', exact: true }).click();
});

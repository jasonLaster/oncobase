import type { Page, TestInfo } from "@playwright/test";
import { publicReaderHealthFlags } from "../scripts/summarize-playwright";

// Export presence flags only: never page text, location queries or HTML.
export async function recordReaderHealth(page: Page, info: TestInfo) {
  if (info.status === info.expectedStatus) return;
  const flags = await page.evaluate((knownFlags) => knownFlags.filter((flag) => {
    if (flag === "login-route") return location.pathname === "/login";
    if (flag === "empty-root") return !document.querySelector("#root")?.childElementCount;
    return Boolean(document.querySelector(`[data-test-id="${flag}"]`));
  }), publicReaderHealthFlags).catch(() => []);
  for (const flag of flags) info.annotations.push({ type: `qa-health:${flag}` });
}

import type { Page, TestInfo } from "@playwright/test";
import { publicReaderHealthFlags } from "../scripts/summarize-playwright";

const pages = new WeakMap<TestInfo, Page>();
export function trackReaderHealth(page: Page, info: TestInfo) {
  pages.set(info, page);
}

// Export presence flags only: never page text, location queries or HTML.
export async function recordReaderHealth(info: TestInfo) {
  const page = pages.get(info);
  pages.delete(info);
  // Do not request another page fixture when its initial setup failed.
  if (!page || page.isClosed() || info.status === info.expectedStatus) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flags = await Promise.race([page.evaluate((knownFlags) => knownFlags.filter((flag) => {
    if (flag === "login-route") return location.pathname === "/login";
    if (flag === "empty-root") return !document.querySelector("#root")?.childElementCount;
    return Boolean(document.querySelector(`[data-test-id="${flag}"]`));
  }), publicReaderHealthFlags).catch(() => []), new Promise<[]>(resolve => {
    timer = setTimeout(() => resolve([]), 2000);
  })]);
  clearTimeout(timer);
  for (const flag of flags) info.annotations.push({ type: `qa-health:${flag}` });
}

import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Chat performance scenarios — Phase 0 baseline + per-phase regression.
 * Captures the metrics described in web/specs/chat-performance-testing.md.
 *
 *   bun playwright test e2e/chat-perf.spec.ts --project=tests
 *
 * Each scenario writes a JSON line to web/e2e/.perf/<scenario>.json so
 * later phases can diff against Phase 0's baseline.
 */

const PERF_DIR = join(import.meta.dirname, ".perf");
if (!existsSync(PERF_DIR)) mkdirSync(PERF_DIR, { recursive: true });

interface PerfSample {
  scenario: string;
  ttfbMs: number | null;
  totalMs: number | null;
  events: number;
  capturedAt: string;
}

async function setup(page: Page) {
  await page.addInitScript(() => {
    // Make sure the perf buffer exists before the page boots.
    (window as unknown as { __CHAT_PERF__?: unknown }).__CHAT_PERF__ = {
      events: [],
      push(e: unknown) {
        (this as { events: unknown[] }).events.push(e);
      },
      drain() {
        const copy = (this as { events: unknown[] }).events.slice();
        (this as { events: unknown[] }).events = [];
        return copy;
      },
      clear() {
        (this as { events: unknown[] }).events = [];
      },
    };
  });
  await page.goto("/chat");
  const url = page.url();
  test.skip(!url.includes("/chat"), "Chat is disabled (redirected to /)");
}

async function readPerf(page: Page): Promise<PerfSample> {
  const raw = await page.evaluate(() => {
    const buf = (
      window as unknown as { __CHAT_PERF__?: { events: Array<{ type: string; t: number; latencyMs?: number; totalMs?: number }> } }
    ).__CHAT_PERF__;
    return buf?.events ?? [];
  });
  const firstToken = raw.find((e) => e.type === "first-token");
  const streamEnd = raw.find((e) => e.type === "stream-end");
  return {
    scenario: "",
    ttfbMs: firstToken?.latencyMs ?? null,
    totalMs: streamEnd?.totalMs ?? null,
    events: raw.length,
    capturedAt: new Date().toISOString(),
  };
}

function writeSample(sample: PerfSample) {
  const path = join(PERF_DIR, `${sample.scenario}.json`);
  writeFileSync(path, JSON.stringify(sample, null, 2));
}

test.describe.configure({ mode: "serial" });

test.describe("Chat perf", () => {
  test.beforeEach(async ({ page }) => {
    await setup(page);
  });

  test("P0-A empty thread, short answer", async ({ page }) => {
    await page.getByRole("textbox").fill("What is the treatment plan?");
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/chat") && r.request().method() === "POST",
        { timeout: 30_000 }
      ),
      page.keyboard.press("Enter"),
    ]);
    // Wait for either Stop button (streaming) or any rendered assistant text.
    await expect(page.getByRole("button", { name: /Stop|Send/ })).toBeVisible({
      timeout: 30_000,
    });
    // Wait until streaming finishes or we time out gracefully.
    await page
      .getByRole("button", { name: "Send" })
      .waitFor({ timeout: 60_000 })
      .catch(() => {});

    const sample = { ...(await readPerf(page)), scenario: "P0-A" };
    writeSample(sample);
    expect(sample.ttfbMs).not.toBeNull();
    if (sample.ttfbMs !== null) {
      expect(sample.ttfbMs).toBeLessThan(10_000);
    }
  });

  test("P0-G abort and resend", async ({ page }) => {
    await page.getByRole("textbox").fill("Tell me everything you know about TNBC.");
    await page.keyboard.press("Enter");
    const stopBtn = page.getByRole("button", { name: "Stop" });
    await stopBtn.waitFor({ timeout: 15_000 });
    await stopBtn.click();
    // Composer should be ready again within 5s.
    await expect(page.getByRole("button", { name: "Send" })).toBeVisible({
      timeout: 5_000,
    });
    const sample = { ...(await readPerf(page)), scenario: "P0-G" };
    writeSample(sample);
  });
});

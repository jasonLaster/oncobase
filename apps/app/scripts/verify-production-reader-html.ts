/** Browser checks for complete no-JavaScript reading and long-page handoff. No content is logged. */
import { chromium, expect } from "@playwright/test";
const origin = process.env.WIKI_PERF_ORIGIN ?? "https://diana-tnbc.com";
const password = process.env.WIKI_PERF_PASSWORD;
if (!password) throw new Error("WIKI_PERF_PASSWORD is required");
const login = await fetch(origin + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
const cookie = login.headers.get("set-cookie")?.split(";")[0];
await login.body?.cancel();
if (!login.ok || !cookie) throw new Error("Login failed");
const split = cookie.indexOf("="), browser = await chromium.launch();
const longPath = "/sources/research/papers/stanford-hai/ai_index_report_2026";
try {
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled, viewport: { width: 1440, height: 1000 } });
    await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    let errors = 0; page.on("pageerror", () => errors++);
    if (!javaScriptEnabled) {
      await page.goto(origin + "/wiki/logistics/insurance");
      await expect(page.locator("#wiki-html-first article")).toBeVisible();
      await page.locator("#wiki-html-first nav").getByRole("link", { name: "Home", exact: true }).click();
      await expect(page).toHaveURL(origin + "/");
      await expect(page.locator("#wiki-html-first article")).toBeVisible();
      await page.goto(origin + longPath);
      const paragraphs = page.locator("#wiki-html-first .wiki-markdown p");
      expect(await paragraphs.count()).toBeGreaterThan(100);
      await paragraphs.last().scrollIntoViewIfNeeded();
      await expect(paragraphs.last()).toBeVisible();
      console.log(JSON.stringify({ case: "complete HTML and native navigation without JavaScript", passed: true, errors }));
    } else {
      await page.goto(origin + longPath, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#wiki-html-first-rest")).toHaveCount(0);
      const heading = page.locator("#wiki-html-first .wiki-markdown :is(h2,h3,h4)[id]").last();
      const id = await heading.getAttribute("id");
      if (!id) throw new Error("Long article has no heading target");
      await heading.scrollIntoViewIfNeeded();
      await page.evaluate(id => { history.replaceState(history.state, "", "#" + id); }, id);
      await expect(heading).toBeVisible();
      await expect(page.locator("#wiki-html-first")).toHaveCount(0, { timeout: 60000 });
      const position = await page.evaluate(id => {
        const heading = document.querySelector("#root #" + CSS.escape(id.replace(/^wiki-html-/, "")));
        if (!heading) return null;
        const box = heading.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, viewport: innerHeight };
      }, id);
      const preserved = Boolean(position && position.top < position.viewport && position.bottom > 0);
      console.log(JSON.stringify({ case: "late heading stays visible through interactive handoff", passed: preserved, errors, position }));
      if (!preserved || errors) throw new Error("Long-page handoff lost the reading position");
    }
    await context.close();
  }
} finally { await browser.close(); }

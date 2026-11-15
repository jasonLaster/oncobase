import { expect, test } from "@playwright/test";

for (const action of ["Escape", "Close"] as const) {
  test(`${action} preserves an already assigned connected focus owner before cleanup`, async ({ page }, info) => {
    const { theme } = info.project.metadata;
    await page.goto(`/?mode=handoff&theme=${theme}`);
    const opener = page.getByRole("button", { name: "Open handoff", exact: true });
    for (let cycle = 0; cycle < 2; cycle++) {
      await opener.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible();
      if (action === "Escape") await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: "Close image preview", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const state = await page.evaluate(() => ({
        beforeCleanup: window.handoffBeforeCleanup,
        afterCleanup: document.activeElement?.id,
        openerConnected: document.getElementById("handoff-opener")?.isConnected,
        viewport: { width: innerWidth, height: innerHeight },
        scheme: getComputedStyle(document.documentElement).colorScheme,
      }));
      await info.attach(`before-cleanup-handoff-${cycle}`, {
        body: JSON.stringify(state), contentType: "application/json",
      });
      expect(state.beforeCleanup).toBe("after-viewer");
      expect(state.openerConnected).toBe(true);
      expect(state.viewport.width).toBe(Number(info.project.name.split("-").at(-1)));
      expect(state.scheme).toBe(theme);
      await expect(page.getByRole("button", { name: "Continue reading", exact: true })).toBeFocused();
    }
  });
}

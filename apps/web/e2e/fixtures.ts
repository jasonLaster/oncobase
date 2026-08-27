import { expect, test as base } from "@playwright/test";

export { expect };

export const test = base.extend<{ browserErrorMonitor: void }>({
  browserErrorMonitor: [
    async ({ page }, use) => {
      const errors: string[] = [];

      page.on("pageerror", (error) => {
        errors.push(`pageerror: ${error.message}`);
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const location = message.location();
        const source = location.url
          ? ` (${location.url}:${location.lineNumber ?? 0})`
          : "";
        errors.push(`console: ${message.text()}${source}`);
      });

      await use();
      expect(errors, "unexpected browser errors").toEqual([]);
    },
    { auto: true },
  ],
});

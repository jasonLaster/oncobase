import { expect } from "@playwright/test";
import { registerReaderParity, type ReaderAdapter } from "../../../e2e-shared/reader-parity";

// Legacy Next.js reader against the real Convex backend. Auth is provided by
// the playwright "tests" project storageState (auth.setup logs in with the
// site password), so the same content is visible.
const adapter: ReaderAdapter = {
  name: "web-live",
  open: async (page, path) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article").first()).toBeVisible({ timeout: 60_000 });
  },
  sidebar: (page) => page.getByTestId("sidebar-tree"),
};

registerReaderParity(adapter);

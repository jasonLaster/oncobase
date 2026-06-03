import { expect } from "@playwright/test";
import { registerReaderParity, type ReaderAdapter } from "../../../e2e-shared/reader-parity";

// Vite reader against the REAL Convex backend (no mocks) — public scope, which
// shows the same public pages the legacy reader serves.
const adapter: ReaderAdapter = {
  name: "vite-live",
  open: async (page, path) => {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("document-article").first()).toBeVisible({ timeout: 90_000 });
  },
  sidebar: (page) => page.getByTestId("wiki-sidebar"),
};

registerReaderParity(adapter);

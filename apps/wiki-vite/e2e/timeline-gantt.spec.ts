import { test } from "@playwright/test";

test.describe.skip("timeline gantt rendering", () => {
  test("renders the timeline gantt mermaid diagram", async () => {
    // Mermaid rendering is still a Next/server-rendered markdown feature.
    // The Vite migration needs a client-safe Mermaid adapter before this can
    // become an active reader-parity test.
  });
});

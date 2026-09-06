import { test } from "@playwright/test";

test.describe.skip("Header shell", () => {
  test("about/Index prerender includes header chrome before hydration", async () => {
    // The Vite prototype is a client-rendered shell. Header chrome is covered
    // after hydration in page-load-experience.spec.ts.
  });
});

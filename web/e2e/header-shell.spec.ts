import { expect, test } from "@playwright/test";

test.describe("Wiki shell", () => {
  test("about/Index prerender includes shared sidebar chrome before hydration", async ({ request, baseURL }) => {
    const response = await request.get(new URL("/about/Index?token=diana", baseURL).toString());

    expect(response.ok()).toBeTruthy();

    const html = await response.text();

    expect(html).toContain('data-test-id="app-shell"');
    expect(html).toContain('aria-label="Workspace menu"');
    expect(html).toContain("Diana TNBC");
    expect(html).toContain('data-test-id="sidebar-search"');
    expect(html).toContain('data-test-id="sidebar-ask-wiki"');
  });
});

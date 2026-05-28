import { expect, test } from "@playwright/test";

test.describe("Header shell", () => {
  test("about/Index prerender includes navigation chrome before hydration", async ({
    request,
    baseURL,
  }) => {
    const response = await request.get(new URL("/about/Index?token=diana", baseURL).toString());

    expect(response.ok()).toBeTruthy();

    const html = await response.text();

    expect(html).toContain('aria-label="Workspace menu"');
    expect(html).toContain("Diana TNBC");
    expect(html).toContain('data-test-id="sidebar-view-comments"');
    expect(html).toContain('href="/index"');
    expect(html).toContain("Ask wiki");
    expect(html).toContain('data-test-id="sidebar-search"');
  });
});

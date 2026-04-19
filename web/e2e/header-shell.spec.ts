import { expect, test } from "@playwright/test";

test.describe("Header shell", () => {
  test("about/Index prerender includes header chrome before hydration", async ({ request, baseURL }) => {
    const response = await request.get(new URL("/about/Index?token=diana", baseURL).toString());

    expect(response.ok()).toBeTruthy();

    const html = await response.text();

    expect(html).toContain('aria-label="Home"');
    expect(html).toContain('placeholder="Search wiki..."');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-label="Find files (⌘P)"');
    expect(html).toContain('aria-label="Actions"');
  });
});

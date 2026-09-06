import { test, expect, signIn, checkpoint, readerPath } from "./fixtures";

for (const route of ["/", readerPath, "/search", "/comments", "/chat", "/diagnostics", "/tools/medical-deduction", "/tools/dicom-viewer"]) {
  test(`anonymous page gate ${route}`, async ({ request }) => {
    const response = await request.get(route, { maxRedirects: 0 });
    expect([302, 307]).toContain(response.status());
    expect(new URL(response.headers().location, "https://example.test").pathname).toBe("/login");
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
}
for (const route of ["/api/wiki/manifest", "/api/wiki/pages?slugs=index", "/api/search?q=parity", "/api/file?path=missing.pdf", "/api/download?type=markdown"]) {
  test(`anonymous API gate ${route}`, async ({ request }) => {
    const response = await request.get(route, { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
}
for (const [path, target] of [["/about", "/about/Index"], ["/about/index", "/about/Index"], ["/wiki/Logistics/Insurance", readerPath], [`${readerPath}/?view=compact`, `${readerPath}?view=compact`]]) {
  test(`canonical navigation ${path}`, async ({ page }, info) => {
    await signIn(page);
    // Next may encode a late server redirect in a streamed HTTP 200 response.
    // The shared user contract is the settled canonical URL and loaded content.
    await page.goto(path);
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(target);
    await expect(page.locator("article").filter({ visible: true }).first()).toBeVisible();
    await checkpoint(page, info, "canonical-destination");
  });
}
test("forged gate cookie does not authorize pages or content APIs", async ({ request }) => {
  for (const route of [readerPath, "/api/wiki/manifest"]) {
    const response = await request.get(route, { maxRedirects: 0, headers: { Cookie: "authed=true" } });
    expect([302, 307, 401]).toContain(response.status());
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});
test("invalid password remains on sign-in with an actionable error", async ({ page }, info) => {
  await page.goto(`/login?redirect=${encodeURIComponent(readerPath)}`);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("deliberately-wrong-parity-password");
  await page.getByRole("button", { name: "Enter", exact: true }).click();
  await expect(page.getByText(/incorrect password|invalid password/i)).toBeVisible();
  await checkpoint(page, info, "invalid-password");
});
test("public terms are available without the reader or authentication", async ({ page, request }, info) => {
  const response = await request.get("/terms-and-conditions/");
  expect(response.status()).toBe(200);
  await page.goto("/terms-and-conditions/");
  await expect(page.getByRole("heading", { name: "Terms and Conditions", exact: true })).toHaveCSS("font-size", "30px");
  await expect(page.getByTestId("wiki-sidebar")).toHaveCount(0);
  await checkpoint(page, info, "public-terms");
});

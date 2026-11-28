import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installWikiApiMocks } from "../fixtures";

// A complete two-page file: PDF.js must actually parse xref offsets and draw.
function samplePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    "", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>", "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, number] of [[3, 1], [5, 2]]) {
    const text = `BT /F1 24 Tf 60 700 Td (Synthetic report page ${number}) Tj ET\n`;
    objects[index] = `<< /Length ${text.length} >>\nstream\n${text}endstream`;
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

for (const width of [393, 1440, 1920]) {
  test(`PDF viewer renders, navigates and downloads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 393 ? 852 : 1000 });
    await installWikiApiMocks(page);
    const bytes = samplePdf();
    await page.route("**/api/file?**", route => route.fulfill({
      contentType: "application/pdf", body: bytes,
      headers: new URL(route.request().url()).searchParams.has("download")
        ? { "Content-Disposition": 'attachment; filename="synthetic.pdf"' } : {},
    }));
    await page.goto("/tools/pdf-viewer?path=sources%2Fsynthetic.pdf");
    await expect(page.locator(".textLayer")).toContainText("Synthetic report page 1");
    const canvas = page.getByRole("img", { name: "Page 1 of 2", exact: true });
    await expect(canvas).toBeVisible();
    const textBox = (await page.locator(".textLayer span").first().boundingBox())!;
    const pageBox = (await canvas.boundingBox())!;
    expect(textBox.width).toBeGreaterThan(pageBox.width * 0.25);
    expect(Math.abs(textBox.x - pageBox.x - pageBox.width * 60 / 612)).toBeLessThan(2);
    expect(await canvas.evaluate((node: HTMLCanvasElement) => {
      const pixels = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
      return pixels.some((value, index) => index % 4 !== 3 && value < 200);
    })).toBe(true);
    await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await page.getByRole("button", { name: "Next page" }).click();
    await expect(page.locator(".textLayer")).toContainText("Synthetic report page 2");
    await expect(page).toHaveURL(/#page=2$/);
    await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
    await page.getByRole("button", { name: "Previous page" }).click();
    await expect(page.locator(".textLayer")).toContainText("Synthetic report page 1");
    const before = (await canvas.boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(before);
    await page.getByRole("button", { name: "Fit page width" }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeCloseTo(before, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.locator(".pdf-viewer-toolbar button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download", exact: true }).click();
    expect((await download).suggestedFilename()).toBe("synthetic.pdf");
    await mkdir(".playwright/pdf-viewer", { recursive: true });
    await page.screenshot({ path: `.playwright/pdf-viewer/${width}.png` });
  });
}

test("a restricted PDF asks a password-only reader to sign in with an account, then opens", async ({ page }) => {
  await installWikiApiMocks(page);
  let signedIn = false;
  const bytes = samplePdf();
  await page.route("**/api/file?**", route => signedIn
    ? route.fulfill({ contentType: "application/pdf", body: bytes })
    : route.fulfill({ status: 404, body: "File not found" }));
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: signedIn ? { email: "care@example.test", name: "Care" } : null } }));
  await page.route("**/api/auth/signin", async route => {
    expect(route.request().postDataJSON()).toEqual({ email: "care@example.test", password: "account-password" });
    signedIn = true;
    return route.fulfill({ json: { ok: true, user: { email: "care@example.test", name: "Care" } } });
  });
  const reports: Record<string, unknown>[] = [];
  await page.route("**/api/client-errors", route => { reports.push(route.request().postDataJSON()); return route.fulfill({ status: 204 }); });
  await page.goto("/tools/pdf-viewer?path=private%2Freport.pdf");
  const alert = page.getByRole("alert");
  await expect(alert.getByRole("heading", { name: "Sign in to open this PDF" })).toBeVisible();
  await expect(alert).toContainText("shared site password doesn't open restricted files");
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]).toMatchObject({ source: "pdf-viewer", stage: "open", path: "private/report.pdf", context: { pdfjs: expect.any(String) } });
  // The download is the same restricted file, so it waits for sign-in too.
  await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download", exact: true })).toHaveAttribute("title", "Sign in to download");

  await alert.getByRole("button", { name: "Sign in", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await dialog.getByLabel("Email", { exact: true }).fill("care@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("account-password");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /^Page 1 of 2$/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveAttribute("href", /download=1/);
});

test("a signed-in reader without access is told so, not asked to sign in again", async ({ page }) => {
  await installWikiApiMocks(page);
  await page.route("**/api/file?**", route => route.fulfill({ status: 404, body: "File not found" }));
  await page.route("**/api/auth/session", route => route.fulfill({ json: { user: { email: "reader@example.test", name: "Reader" } } }));
  await page.route("**/api/client-errors", route => route.fulfill({ status: 204 }));
  await page.goto("/tools/pdf-viewer?path=private%2Freport.pdf");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your account doesn't have access to this PDF");
  await expect(alert.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  await expect(alert.getByRole("link", { name: "Source page" })).toHaveAttribute("href", "/private/report");
  await expect(page.getByRole("button", { name: "Download", exact: true })).toBeDisabled();
});

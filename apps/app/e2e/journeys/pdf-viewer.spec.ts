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

test("PDF errors offer sign-in and the original download", async ({ page }) => {
  await installWikiApiMocks(page);
  await page.route("**/api/file?**", route => route.fulfill({ status: 404, body: "File not found" }));
  await page.goto("/tools/pdf-viewer?path=private%2Freport.pdf");
  await expect(page.getByRole("alert")).toContainText("could not be opened");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", /redirect=.*pdf-viewer/);
  await expect(page.getByRole("link", { name: "Download", exact: true })).toBeVisible();
});

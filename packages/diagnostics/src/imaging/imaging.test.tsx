import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticImaging } from "./index";
import type { PathologySlide } from "../pathology/model";

test("eleven H&E slides share one desktop row and one mobile card with collection actions", () => {
  const pathologySlides = Array.from({ length: 11 }, (_, i) => ({
    slideId: `he-${i}`, label: `Slide ${i}`, stain: "H&E", scanDate: i < 9 ? "10/13/2026" : "07/09/2026",
  })) as PathologySlide[];
  const html = renderToStaticMarkup(<DiagnosticImaging studies={[]} comparisons={[]} pathologySlides={pathologySlides} />);
  expect((html.match(/<tr>/g) ?? []).length).toBe(2); // Header and one collection row.
  expect((html.match(/class="diagnostics-study-card"/g) ?? []).length).toBe(1);
  expect(html).toContain("11 whole-slide images");
  expect(html).toContain("Jul 9 – Oct 13, 2026 (scans)");
  expect(html).toContain('href="/tools/pathology-viewer?stain=H%26E"');
  expect(html).toContain("Compare slides");
  expect(html).not.toContain("H&amp;E slide ·");
});

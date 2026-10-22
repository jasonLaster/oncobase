import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticImaging } from "./index";
import type { PathologySlide } from "../pathology/model";

test("July and October H&E sets have separate rows, cards, counts and viewer links", () => {
  const pathologySlides = Array.from({ length: 11 }, (_, i) => ({
    slideId: `he-${i}`, label: `Slide ${i}`, stain: "H&E", scanDate: i < 9 ? "10/13/2026" : "07/09/2026",
  })) as PathologySlide[];
  const html = renderToStaticMarkup(<DiagnosticImaging studies={[]} comparisons={[]} pathologySlides={pathologySlides} />);
  expect((html.match(/<tr>/g) ?? []).length).toBe(3); // Header and two dated sets.
  expect((html.match(/class="diagnostics-study-card"/g) ?? []).length).toBe(2);
  expect(html).toContain("9 whole-slide images");
  expect(html).toContain("2 whole-slide images");
  expect(html).toContain("Oct 13, 2026 (scan)");
  expect(html).toContain("Jul 9, 2026 (scan)");
  expect(html).toContain("collection=H%26E%3A2026-10-13");
  expect(html).toContain("collection=H%26E%3A2026-07-09");
  expect(html).toContain("Compare slides");
  expect(html).not.toContain("H&amp;E slide ·");
});


test("protein stains get separate rows without changing the H&E sets", () => {
  const pathologySlides = ["H&E", "H&E", "PanKera", "PanKera", "ER", "PR", "HER2", "MIB1", "p63"].map((stain, i) => ({
    slideId: `he-${i}`, label: `Slide ${i}`, stain, scanDate: i === 0 ? "07/09/2026" : "10/13/2026",
  })) as PathologySlide[];
  const html = renderToStaticMarkup(<DiagnosticImaging studies={[]} comparisons={[]} pathologySlides={pathologySlides} />);
  expect((html.match(/<tr>/g) ?? []).length).toBe(9);
  for (const stain of ["PanKera", "ER", "PR", "HER2", "MIB1", "p63"]) {
    expect(html).toContain(`${stain} slides`);
    expect(html).toContain(`collection=${stain}%3A2026-10-13`);
  }
  expect(html).toContain("collection=H%26E%3A2026-07-09");
  expect(html).toContain("collection=H%26E%3A2026-10-13");
});

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticImaging } from "./index";
import type { PathologySlide } from "../pathology/model";

test("July and October have separate pathology rows, cards and viewer links", () => {
  const pathologySlides = Array.from({ length: 11 }, (_, i) => ({
    slideId: `he-${i}`, label: `Slide ${i}`, stain: "H&E", scanDate: i < 9 ? "10/13/2026" : "07/09/2026",
  })) as PathologySlide[];
  const html = renderToStaticMarkup(<DiagnosticImaging studies={[]} comparisons={[]} pathologySlides={pathologySlides} />);
  expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  expect((html.match(/class="diagnostics-study-card"/g) ?? []).length).toBe(2);
  expect(html).toContain("9 slides");
  expect(html).toContain("2 slides");
  expect(html).toContain("Oct 13, 2026 (scan)");
  expect(html).toContain("Jul 9, 2026 (scan)");
  expect(html).toContain("collection=2026-10-13");
  expect(html).toContain("collection=2026-07-09");
  expect(html).toContain("Compare slides");
});

test("all nineteen October slides share one pathology row regardless of stain", () => {
  const stains = [...Array(9).fill("H&E"), ...Array(5).fill("PanKera"), "ER", "PR", "HER2", "MIB1", "p63"];
  const pathologySlides = stains.map((stain, i) => ({ slideId: `he-${i}`, label: `Slide ${i}`, stain, scanDate: "10/13/2026" })) as PathologySlide[];
  const html = renderToStaticMarkup(<DiagnosticImaging studies={[]} comparisons={[]} pathologySlides={pathologySlides} />);
  expect((html.match(/<tr>/g) ?? []).length).toBe(2);
  expect((html.match(/class="diagnostics-study-card"/g) ?? []).length).toBe(1);
  expect(html).toContain("19 slides · 7 stains");
  expect(html).toContain('href="/tools/pathology-viewer?collection=2026-10-13"');
  expect(html).not.toContain("PanKera slides");
});

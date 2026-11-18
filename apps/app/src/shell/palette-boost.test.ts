import { expect, test } from "bun:test";
import { paletteBoost } from "./palette-boost";

test("curated pages and records rank above clippings and archives", () => {
  const order = [
    "wiki/care/treatment-plan",
    "sources/diagnostics/03-27-petct",
    "wiki/education/concepts/pet-ct",
    "wiki/diagnostics/archived/brca-hrd",
    "sources/emails/notes",
    "sources/emails/10-06-email-ingest/attachments/report",
    "sources/research/papers/medsam",
  ].map(paletteBoost);
  expect([...order].sort((a, b) => b - a)).toEqual(order);
});

test("newer dated records edge out older ones, by file or by folder", () => {
  expect(paletteBoost("sources/diagnostics/09-21-signatera-ctdna")).toBeGreaterThan(paletteBoost("sources/diagnostics/04-18-signatera-ctdna"));
  expect(paletteBoost("sources/diagnostics/11-03-surgical-pathology/analysis")).toBeGreaterThan(paletteBoost("sources/diagnostics/09-24-surgical-pathology/analysis"));
  expect(paletteBoost("sources/diagnostics/13-40-not-a-date")).toBe(paletteBoost("sources/diagnostics/plain"));
  // Recency never outweighs the folder prior.
  expect(paletteBoost("sources/research/12-31-paper")).toBeLessThan(paletteBoost("sources/emails/01-01-note"));
});

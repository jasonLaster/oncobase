import { expect, test } from "bun:test";
import type { PageIndexRow } from "../types";
import { recommendCandidates } from "./palette-recommend";

const row = (slug: string, title: string, tags: string[] = [], description: string | null = null): PageIndexRow =>
  ({ slug, title, tagsJson: JSON.stringify(tags), description, contentHash: null, sensitive: false, size: 1 });
const notes = Array.from({ length: 30 }, (_, i) => [
  row(`sources/meeting-notes/0${i}---call-overview`, `Call ${i}`),
  row(`sources/meeting-notes/0${i}---call-raw`, `Call ${i} raw`),
]).flat();
const pages = [
  ...notes,
  row("sources/meeting-notes/05-13---tissue-sync-overview", "Tissue sync"),
  row("wiki/care/tissue-and-data", "Tissue allocation plan", ["tissue-allocation"]),
  row("sources/diagnostics/11-03-surgical-pathology/11-03-surgical-pathology", "November 3 surgical pathology — completion mastectomy and margins", ["pathology"]),
  row("wiki/care/treatment", "Treatment", [], "Includes the tissue plan"),
];

test("rare query words outweigh common ones, and partial words match by prefix", () => {
  const tissue = recommendCandidates(pages, "tissue overview", [], 3).map(page => page.slug).sort();
  // The 30 plain call overviews share only "overview", so the tissue pages take every slot.
  expect(tissue).toEqual(["sources/meeting-notes/05-13---tissue-sync-overview", "wiki/care/tissue-and-data", "wiki/care/treatment"]);
  expect(recommendCandidates(pages, "mastectom path report", [], 1)[0]?.slug).toBe("sources/diagnostics/11-03-surgical-pathology/11-03-surgical-pathology");
});

test("fuzzy matches come first, raw note siblings never take a slot, metadata travels", () => {
  const candidates = recommendCandidates(pages, "call", ["wiki/care/treatment"], 40);
  expect(candidates[0]).toEqual({ slug: "wiki/care/treatment", title: "Treatment", description: "Includes the tissue plan", rank: 1 });
  expect(candidates.slice(1).some(page => page.rank)).toBe(false);
  expect(candidates.some(page => page.slug.endsWith("-raw"))).toBe(false);
  expect(recommendCandidates(pages, "tissue", [], 40).find(page => page.slug === "wiki/care/tissue-and-data")?.tags).toEqual(["tissue-allocation"]);
});

test("a query of only short or common words asks about nothing new", () => {
  expect(recommendCandidates(pages, "a of the", [])).toEqual([]);
});

test("shorthand and month names find the spelled-out page", () => {
  const dated = [...pages, row("sources/emails/06-29-healthier-follow-up", "Healthier follow-up"), row("sources/test-results/09-apr-09-2026-cbc", "CBC")];
  expect(recommendCandidates(dated, "healthier fu", [], 1)[0]?.slug).toBe("sources/emails/06-29-healthier-follow-up");
  expect(recommendCandidates(dated, "april cbc", [], 1)[0]?.slug).toBe("sources/test-results/09-apr-09-2026-cbc");
});

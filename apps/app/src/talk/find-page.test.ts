import { expect, test } from "bun:test";
import type { PageIndexRow } from "../types";
import { pagesNamed } from "./find-page";

const row = (slug: string, title: string) => ({ slug, title, tagsJson: "[]", description: null, contentHash: null, sensitive: false, size: 1 }) as unknown as PageIndexRow;
const pages = [
  row("wiki/research/reviews/2026-11-adjuvant-planning", "Adjuvant planning in survival terms"),
  row("wiki/research/reviews/2026-11-adjuvant-planning/sacituzumab-govitecan", "Sacituzumab govitecan"),
  row("sources/meeting-notes/08-26-weekly-call-adjuvant-planning-overview", "Weekly call: adjuvant planning"),
  row("wiki/care/treatment-plan", "Treatment Plan"),
];

test("a spoken request finds the page named that way, by file name or title", () => {
  expect(pagesNamed(pages, "take me back to the adjuvant planning page").map(page => page.slug)).toEqual(["wiki/research/reviews/2026-11-adjuvant-planning"]);
  expect(pagesNamed(pages, "the treatment plan").map(page => page.slug)).toEqual(["wiki/care/treatment-plan"]);
  expect(pagesNamed(pages, "Sacituzumab govitecan").map(page => page.slug)).toEqual(["wiki/research/reviews/2026-11-adjuvant-planning/sacituzumab-govitecan"]);
});

test("a topic that names no page exactly is left to Jev", () => {
  expect(pagesNamed(pages, "adjuvant")).toEqual([]);
  expect(pagesNamed(pages, "the page")).toEqual([]);
});

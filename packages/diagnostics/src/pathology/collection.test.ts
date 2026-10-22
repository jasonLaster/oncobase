import { describe, expect, test } from "bun:test";
import { pathologyCollectionHref, pathologyCollectionId, pathologyCollections, slideScanDate, sortPathologySlides } from "./collection";
import type { PathologySlide } from "./model";

const slide = (slideId: string, scanDate?: string, stain = "H&E") => ({ slideId, label: slideId, scanDate, stain }) as PathologySlide;

describe("pathology collections", () => {
  test("keeps July and October in separate sets without changing source records", () => {
    const slides = [slide("older", "07/09/2026"), slide("recent-b", "10/13/2026"), slide("recent-a", "10/13/2026")];
    const groups = pathologyCollections(slides);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => [g.dateLabel, g.slides.map(s => s.slideId)])).toEqual([
      ["Oct 13, 2026 (scan)", ["recent-a", "recent-b"]],
      ["Jul 9, 2026 (scan)", ["older"]],
    ]);
    expect(groups[0].id).not.toBe(groups[1].id);
    expect(slides.map(s => s.slideId)).toEqual(["older", "recent-b", "recent-a"]);
  });

  test("keeps other stains and unavailable dates separate rather than inferring an association", () => {
    const groups = pathologyCollections([slide("unknown", "02/30/2026"), slide("also-unknown"), slide("known", "10/13/2026"), slide("ihc", "10/13/2026", "HER2")]);
    expect(groups).toHaveLength(4);
    expect(groups.filter(g => g.unknownDates).map(g => g.slides.length)).toEqual([1, 1]);
    expect(groups.find(g => g.slides[0].slideId === "unknown")?.dateLabel).toBe("Scan date unavailable");
    expect(slideScanDate("02/30/2026").isoDate).toBe("");
    expect(pathologyCollections([])).toEqual([]);
  });

  test("collection links retain the selected set and exact primary and comparison identities", () => {
    const collection = { id: pathologyCollectionId(slide("first", "10/13/2026")), stain: "H&E" };
    const url = new URL(pathologyCollectionHref(collection, "first", "last"), "https://example.test");
    expect([...url.searchParams]).toEqual([["stain", "H&E"], ["collection", "H&E:2026-10-13"], ["slide", "first"], ["compare", "last"]]);
    expect(sortPathologySlides([slide("unknown"), slide("known", "10/13/2026")]).map(s => s.slideId)).toEqual(["known", "unknown"]);
  });
});

import { describe, expect, test } from "bun:test";
import { normalizePathologyCollectionId, pathologyCollectionHref, pathologyCollectionId, pathologyCollections, slideScanDate, sortPathologySlides } from "./collection";
import type { PathologySlide } from "./model";
const slide = (slideId: string, scanDate?: string, stain = "H&E") => ({ slideId, label: slideId, scanDate, stain }) as PathologySlide;

describe("pathology collections", () => {
  test("groups October stains together while keeping July and source records separate", () => {
    const slides = [slide("older", "07/09/2026"), slide("recent-b", "10/13/2026", "HER2"), slide("recent-a", "10/13/2026")];
    const groups = pathologyCollections(slides);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => [g.dateLabel, g.slides.map(s => s.slideId)])).toEqual([
      ["Oct 13, 2026 (scan)", ["recent-a", "recent-b"]], ["Jul 9, 2026 (scan)", ["older"]],
    ]);
    expect(groups[0].stains).toEqual(["H&E", "HER2"]);
    expect(groups[0].id).toBe("2026-10-13");
    expect(slides.map(s => s.slideId)).toEqual(["older", "recent-b", "recent-a"]);
  });
  test("keeps unavailable scan dates separate rather than inferring a date", () => {
    const groups = pathologyCollections([slide("unknown", "02/30/2026"), slide("also-unknown"), slide("known", "10/13/2026"), slide("ihc", "10/13/2026", "HER2")]);
    expect(groups).toHaveLength(3);
    expect(groups.filter(g => g.unknownDates).map(g => g.slides.length)).toEqual([1, 1]);
    expect(groups.find(g => g.slides[0].slideId === "unknown")?.dateLabel).toBe("Scan date unavailable");
    expect(slideScanDate("02/30/2026").isoDate).toBe("");
    expect(pathologyCollections([])).toEqual([]);
  });
  test("date links retain exact primary and comparison identities", () => {
    const collection = { id: pathologyCollectionId(slide("first", "10/13/2026")) };
    const url = new URL(pathologyCollectionHref(collection, "first", "last"), "https://example.test");
    expect([...url.searchParams]).toEqual([["collection", "2026-10-13"], ["slide", "first"], ["compare", "last"]]);
    expect(sortPathologySlides([slide("unknown"), slide("known", "10/13/2026")]).map(s => s.slideId)).toEqual(["known", "unknown"]);
  });
  test("legacy stain collection links resolve to their original scan date", () => {
    expect(normalizePathologyCollectionId("HER2:2026-10-13")).toBe("2026-10-13");
    expect(normalizePathologyCollectionId("H&E:2026-07-09")).toBe("2026-07-09");
    expect(normalizePathologyCollectionId("2026-10-13")).toBe("2026-10-13");
    expect(normalizePathologyCollectionId(null)).toBeNull();
  });
});

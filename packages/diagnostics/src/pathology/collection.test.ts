import { describe, expect, test } from "bun:test";
import { pathologyCollectionHref, pathologyCollections, slideScanDate, sortPathologySlides } from "./collection";
import type { PathologySlide } from "./model";

const slide = (slideId: string, scanDate?: string, stain = "H&E") => ({ slideId, label: slideId, scanDate, stain }) as PathologySlide;

describe("pathology collections", () => {
  test("rolls multiple scan dates into one stain collection without changing source records", () => {
    const slides = [slide("older", "07/09/2026"), slide("recent-b", "10/13/2026"), slide("recent-a", "10/13/2026")];
    const groups = pathologyCollections(slides);
    expect(groups).toHaveLength(1);
    expect(groups[0].dateLabel).toBe("Jul 9 – Oct 13, 2026 (scans)");
    expect(groups[0].isoDate).toBe("2026-10-13");
    expect(groups[0].slides.map(s => s.slideId)).toEqual(["recent-a", "recent-b", "older"]);
    expect(slides.map(s => s.slideId)).toEqual(["older", "recent-b", "recent-a"]);
  });

  test("keeps other stains separate and does not invent unavailable dates", () => {
    const groups = pathologyCollections([slide("unknown", "02/30/2026"), slide("known", "10/13/2026"), slide("ihc", undefined, "HER2")]);
    expect(groups).toHaveLength(2);
    expect(groups[0].unknownDates).toBe(1);
    expect(groups[0].dateLabel).toBe("Oct 13, 2026 (scan)");
    expect(groups[1].dateLabel).toBe("Scan date unavailable");
    expect(slideScanDate("02/30/2026").isoDate).toBe("");
    expect(pathologyCollections([])).toEqual([]);
  });

  test("collection links retain stain and exact primary and comparison identities", () => {
    expect(pathologyCollectionHref("H&E")).toBe("/tools/pathology-viewer?stain=H%26E");
    const url = new URL(pathologyCollectionHref("H&E", "first", "last"), "https://example.test");
    expect([...url.searchParams]).toEqual([["stain", "H&E"], ["slide", "first"], ["compare", "last"]]);
    expect(sortPathologySlides([slide("unknown"), slide("known", "10/13/2026")]).map(s => s.slideId)).toEqual(["known", "unknown"]);
  });
});

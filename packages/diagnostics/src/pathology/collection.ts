import type { PathologySlide } from "./model";

const formatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

export function slideScanDate(scanDate?: string) {
  const match = scanDate?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const isoDate = match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
  const date = new Date(`${isoDate}T00:00:00Z`);
  return isoDate && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(isoDate)
    ? { isoDate, label: formatter.format(date) }
    : { isoDate: "", label: "Scan date unavailable" };
}

export function sortPathologySlides(slides: PathologySlide[]) {
  return [...slides].sort((left, right) =>
    slideScanDate(right.scanDate).isoDate.localeCompare(slideScanDate(left.scanDate).isoDate)
    || left.label.localeCompare(right.label)
    || left.slideId.localeCompare(right.slideId));
}

export function pathologyCollectionId(slide: PathologySlide) {
  return `${slide.stain}:${slideScanDate(slide.scanDate).isoDate || slide.slideId}`;
}

export function pathologyCollectionHref(collection: { id: string; stain: string }, slideId?: string, compareId?: string) {
  const params = new URLSearchParams({ stain: collection.stain, collection: collection.id });
  if (slideId) params.set("slide", slideId);
  if (compareId) params.set("compare", compareId);
  return `/tools/pathology-viewer?${params}`;
}

export function pathologyCollections(slides: PathologySlide[]) {
  const groups = new Map<string, PathologySlide[]>();
  for (const slide of sortPathologySlides(slides)) {
    const id = pathologyCollectionId(slide);
    const group = groups.get(id) ?? [];
    group.push(slide);
    groups.set(id, group);
  }
  return [...groups].map(([id, associatedSlides]) => {
    const date = slideScanDate(associatedSlides[0].scanDate);
    return {
      id, stain: associatedSlides[0].stain, slides: associatedSlides, isoDate: date.isoDate,
      dateLabel: date.isoDate ? `${date.label} (scan)` : date.label,
      unknownDates: date.isoDate ? 0 : associatedSlides.length,
    };
  });
}

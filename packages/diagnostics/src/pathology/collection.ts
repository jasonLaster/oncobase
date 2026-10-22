import type { PathologySlide } from "./model";

const formatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});
const stainOrder = new Map(["H&E", "PanKera", "ER", "PR", "HER2", "MIB1", "p63"].map((stain, index) => [stain, index]));

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
  return slideScanDate(slide.scanDate).isoDate || `slide:${slide.slideId}`;
}

export function normalizePathologyCollectionId(id: string | null) {
  if (!id) return null;
  const date = id.match(/(?:^|:)(\d{4}-\d{2}-\d{2})$/);
  if (date) return date[1];
  const source = id.match(/:(he-[a-f0-9]{20})$/);
  return source ? `slide:${source[1]}` : id;
}

export function pathologyCollectionHref(collection: { id: string }, slideId?: string, compareId?: string) {
  const params = new URLSearchParams({ collection: collection.id });
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
    const stains = [...new Set(associatedSlides.map(slide => slide.stain))]
      .sort((a, b) => (stainOrder.get(a) ?? stainOrder.size) - (stainOrder.get(b) ?? stainOrder.size) || a.localeCompare(b));
    return {
      id, stains, slides: associatedSlides, isoDate: date.isoDate,
      dateLabel: date.isoDate ? `${date.label} (scan)` : date.label,
      unknownDates: date.isoDate ? 0 : associatedSlides.length,
    };
  });
}

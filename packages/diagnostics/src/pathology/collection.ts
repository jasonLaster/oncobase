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

export function pathologyCollectionHref(stain: string, slideId?: string, compareId?: string) {
  const params = new URLSearchParams({ stain });
  if (slideId) params.set("slide", slideId);
  if (compareId) params.set("compare", compareId);
  return `/tools/pathology-viewer?${params}`;
}

export function pathologyCollections(slides: PathologySlide[]) {
  const groups = new Map<string, PathologySlide[]>();
  for (const slide of sortPathologySlides(slides)) {
    const group = groups.get(slide.stain) ?? [];
    group.push(slide);
    groups.set(slide.stain, group);
  }
  return [...groups].map(([stain, associatedSlides]) => {
    const dates = associatedSlides.map(slide => slideScanDate(slide.scanDate));
    const known = dates.filter(date => date.isoDate);
    const newest = known[0], oldest = known.at(-1);
    const firstLabel = oldest && newest && oldest.isoDate.slice(0, 4) === newest.isoDate.slice(0, 4)
      ? oldest.label.replace(/, \d{4}$/, "") : oldest?.label;
    const dateLabel = newest && oldest
      ? oldest.isoDate === newest.isoDate ? `${newest.label} (scan)` : `${firstLabel} – ${newest.label} (scans)`
      : "Scan date unavailable";
    return {
      stain, slides: associatedSlides, isoDate: newest?.isoDate ?? "", dateLabel,
      unknownDates: dates.length - known.length,
    };
  });
}

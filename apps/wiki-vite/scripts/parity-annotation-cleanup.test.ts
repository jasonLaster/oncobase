import { expect, test } from "bun:test";
import { emptyOwnedRowIds } from "./parity-annotation-cleanup";

const seriesKey = "playwright-parity-00000000-0000-4000-8000-000000000001";
const row = { id: "owned-row", tableName: "imageAnnotations", seriesKey, imageKey: `${seriesKey}/fixture.dcm`, annotationCount: 0 };
const images = new Set([row.imageKey]);

test("cleanup accepts only empty rows in the exact owned namespace and image set", () => {
  expect(emptyOwnedRowIds(seriesKey, images, [row])).toEqual([row.id]);
  expect(emptyOwnedRowIds(seriesKey, images, [])).toEqual([]);
});
for (const [name, change] of [
  ["another namespace", { seriesKey: seriesKey.replace(/1$/, "2") }],
  ["another image", { imageKey: "clinical.dcm" }],
  ["nonempty annotations", { annotationCount: 1 }],
  ["missing ID", { id: "" }],
  ["another table", { tableName: "users" }],
] as const) {
  test(`cleanup refuses ${name}`, () => {
    expect(() => emptyOwnedRowIds(seriesKey, images, [{ ...row, ...change }])).toThrow("unowned");
  });
}
test("cleanup accepts only the owned catalog series and image aliases, never blobs", () => {
  const series = { ...row, id: "series", tableName: "dicomSeries", imageKey: `4-10 biopsy/${seriesKey}` };
  const image = { ...row, id: "image", tableName: "dicomImages" };
  expect(emptyOwnedRowIds(seriesKey, images, [series, image, row])).toEqual(["series", "image", row.id]);
  expect(() => emptyOwnedRowIds(seriesKey, images, [{ ...series, imageKey: "clinical" }])).toThrow();
  expect(() => emptyOwnedRowIds(seriesKey, images, [{ ...image, imageKey: "clinical/fixture.dcm" }])).toThrow();
});
for (const key of ["1.2.840.clinical", "playwright-parity-", "playwright-parity-*"]) {
  test(`cleanup refuses broad or clinical key ${key}`, () => {
    expect(() => emptyOwnedRowIds(key, images, [])).toThrow("exact test-owned");
  });
}

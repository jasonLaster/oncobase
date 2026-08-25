import { describe, expect, test } from "bun:test";

import { comparisonAnnotationTargets } from "./comparison-annotations.ts";
import { annotationsForImage } from "./dicom-annotation-data.ts";

describe("DICOM comparison annotation targets", () => {
  test("maps stored annotations to stack images and formats calibrated rulers", () => {
    const targets = comparisonAnnotationTargets(
      "left",
      {
        images: [
          {
            imagePath: "/stored/june-focus.dcm",
            annotations: [
              {
                id: "audit-june-focus",
                kind: "ruler",
                x: 0.4,
                y: 0.4,
                endX: 0.5,
                endY: 0.5,
                worldStart: [0, 0, 0],
                worldEnd: [0, 8, 0],
                text: "June report-anchored focus",
                color: "#f59e0b",
                thickness: 3,
                fontSize: 22,
              },
            ],
          },
        ],
      },
      [
        {
          fileName: "june-focus.dcm",
          instanceNumber: 124,
          relativePath: "06-26-breast-mri/dicoms/june-focus.dcm",
        },
      ],
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      annotationId: "audit-june-focus",
      detail: "8.0 mm · image #124",
      imageIndex: 0,
      label: "June report-anchored focus",
      side: "left",
    });
  });

  test("ignores annotations whose image is not in the selected stack", () => {
    const targets = comparisonAnnotationTargets(
      "right",
      {
        images: [
          {
            imageKey: "other-series.dcm",
            annotations: [
              {
                id: "unrelated",
                kind: "text",
                x: 0.5,
                y: 0.5,
                text: "Not in this stack",
                color: "#fff",
                thickness: 2,
                fontSize: 18,
              },
            ],
          },
        ],
      },
      [
        {
          fileName: "selected-series.dcm",
          instanceNumber: 1,
          relativePath: "selected-series.dcm",
        },
      ],
    );

    expect(targets).toEqual([]);
  });

  test("finds stored annotations by file name when path prefixes differ", () => {
    const annotation = {
      id: "path-compatible",
      kind: "text" as const,
      x: 0.5,
      y: 0.5,
      text: "Stored annotation",
      color: "#ffffff",
      thickness: 2,
      fontSize: 18,
    };

    expect(
      annotationsForImage(
        { "/stored/path/image.dcm": [annotation] },
        { fileName: "image.dcm", relativePath: "catalog/path/image.dcm" },
      ),
    ).toEqual([annotation]);
  });
});

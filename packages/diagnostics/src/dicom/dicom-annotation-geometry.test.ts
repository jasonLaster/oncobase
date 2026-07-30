import { describe, expect, test } from "bun:test";

import {
  formatDistanceMm,
  makeAnnotation,
  worldDistanceMm,
} from "./dicom-annotation-geometry.ts";

describe("DICOM ruler annotations", () => {
  test("creates a two-endpoint ruler", () => {
    const ruler = makeAnnotation({
      color: "#45a6e8",
      current: { x: 0.6, y: 0.7 },
      fontSize: 22,
      kind: "ruler",
      start: { x: 0.2, y: 0.3 },
      text: "",
      thickness: 3,
    });

    expect(ruler).toMatchObject({
      kind: "ruler",
      x: 0.2,
      y: 0.3,
      endX: 0.6,
      endY: 0.7,
    });
  });

  test("measures patient-space endpoints in millimeters", () => {
    const distance = worldDistanceMm({
      id: "audit-ruler",
      kind: "ruler",
      x: 0.2,
      y: 0.3,
      endX: 0.4,
      endY: 0.5,
      worldStart: [12, -4, 20],
      worldEnd: [15, 0, 20],
      color: "#45a6e8",
      thickness: 3,
      fontSize: 22,
    });

    expect(distance).toBe(5);
    expect(formatDistanceMm(distance)).toBe("5.0 mm");
    expect(formatDistanceMm(57.04)).toBe("57 mm");
    expect(formatDistanceMm(null)).toBe("Uncalibrated");
  });
});

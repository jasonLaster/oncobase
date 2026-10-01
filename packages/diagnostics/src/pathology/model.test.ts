import { expect, test } from "bun:test";
import { readCamera, regionLengthMicrons } from "./model";
import type { PathologySlide } from "./model";

test("rulers preserve anisotropic scanner calibration", () => {
  const slide = { mppX: 0.25, mppY: 0.5 } as PathologySlide;
  expect(regionLengthMicrons({ id: "r", kind: "ruler", x: 0, y: 0, endX: 12, endY: 8, label: "", note: "", color: "#eab308" }, slide)).toBe(5);
  expect(regionLengthMicrons({ id: "r", kind: "ruler", x: 0, y: 0, endX: 12, endY: 8, label: "", note: "", color: "#eab308" }, {} as PathologySlide)).toBeNull();
});

test("shared camera rejects missing or non-finite coordinates and unbounded digital zoom", () => {
  expect(readCamera(new URLSearchParams("x=20&y=40&zoom=.5&rotation=450"))).toEqual({ x: 20, y: 40, zoom: .5, rotation: 90 });
  for (const input of ["", "x=1&y=2&zoom=1", "x=Infinity&y=2&zoom=1&rotation=0", "x=1&y=2&zoom=10&rotation=0"]) {
    expect(readCamera(new URLSearchParams(input))).toBeNull();
  }
});

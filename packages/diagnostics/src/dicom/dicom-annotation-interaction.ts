import type { PointerEvent } from "react";

import { clampUnit } from "./dicom-annotation-geometry.ts";
import type { Point } from "./dicom-annotation-model.ts";

export function pointFromSvgPointer(event: PointerEvent<SVGElement>): Point {
  const svg =
    event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget.ownerSVGElement;
  const rect = svg?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return {
    x: clampUnit((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clampUnit((event.clientY - rect.top) / Math.max(1, rect.height)),
  };
}

export function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

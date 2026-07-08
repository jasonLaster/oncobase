"use client";

import type { PointerEvent, ReactNode } from "react";

import {
  HANDLE_ACTIVE_FILL_COLOR,
  HANDLE_FILL_COLOR,
  HANDLE_STROKE_COLOR,
  SELECTED_STROKE_COLOR,
  type DicomAnnotation,
  type EditHandle,
  type LayerSize,
  type Point,
  type RectBounds,
} from "./dicom-annotation-model.ts";
import { svgPoint, textBounds } from "./dicom-annotation-geometry.ts";

function arrowVisualGeometry(
  annotation: DicomAnnotation,
  layerSize: LayerSize,
  strokeWidth = annotation.thickness,
) {
  const start = svgPoint(annotation, layerSize);
  const end = svgPoint(
    {
      x: annotation.endX ?? annotation.x,
      y: annotation.endY ?? annotation.y,
    },
    layerSize,
  );
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);

  if (length < 1) {
    return {
      end,
      lineEnd: end,
      points: `${end.x},${end.y}`,
    };
  }

  const unitX = dx / length;
  const unitY = dy / length;
  const headLength = Math.min(Math.max(18, strokeWidth * 4 + 10), length * 0.55);
  const headWidth = Math.max(14, strokeWidth * 3 + 8);
  const base = {
    x: end.x - unitX * headLength,
    y: end.y - unitY * headLength,
  };
  const perp = {
    x: -unitY * (headWidth / 2),
    y: unitX * (headWidth / 2),
  };

  return {
    end,
    lineEnd: length > headLength ? base : end,
    points: [
      `${end.x},${end.y}`,
      `${base.x + perp.x},${base.y + perp.y}`,
      `${base.x - perp.x},${base.y - perp.y}`,
    ].join(" "),
  };
}

export function AnnotationShape({
  activeDragHandle,
  annotation,
  editable,
  layerSize,
  onStartEditDrag,
  onTextEdit,
  primarySelected,
  selected,
}: {
  activeDragHandle: EditHandle | null;
  annotation: DicomAnnotation;
  editable: boolean;
  layerSize: LayerSize;
  onStartEditDrag: (
    event: PointerEvent<SVGElement>,
    annotation: DicomAnnotation,
    mode: EditHandle,
  ) => void;
  onTextEdit: (annotation: DicomAnnotation) => void;
  primarySelected: boolean;
  selected: boolean;
}) {
  const start = svgPoint(annotation, layerSize);
  const strokeWidth = annotation.thickness;
  const handle = (mode: EditHandle, point: Point) => (
    <AnnotationHandle
      active={activeDragHandle === mode}
      key={mode}
      layerSize={layerSize}
      mode={mode}
      onPointerDown={(event) => onStartEditDrag(event, annotation, mode)}
      point={point}
    />
  );

  if (annotation.kind === "arrow") {
    const end = {
      x: annotation.endX ?? annotation.x,
      y: annotation.endY ?? annotation.y,
    };
    const arrow = arrowVisualGeometry(annotation, layerSize);
    const selectedArrow = arrowVisualGeometry(
      annotation,
      layerSize,
      annotation.thickness + 2,
    );
    const middle = {
      x: (annotation.x + end.x) / 2,
      y: (annotation.y + end.y) / 2,
    };
    return (
      <g>
        {selected ? (
          <>
            <line
              data-test-id="dicom-annotation-selection"
              pointerEvents="none"
              stroke={SELECTED_STROKE_COLOR}
              strokeLinecap="round"
              strokeWidth={Math.max(5, strokeWidth + 4)}
              vectorEffect="non-scaling-stroke"
              x1={start.x}
              x2={selectedArrow.lineEnd.x}
              y1={start.y}
              y2={selectedArrow.lineEnd.y}
            />
            <polygon
              fill={SELECTED_STROKE_COLOR}
              pointerEvents="none"
              points={selectedArrow.points}
            />
          </>
        ) : null}
        <line
          data-test-id="dicom-annotation-shape-arrow"
          stroke={annotation.color}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          x1={start.x}
          x2={arrow.lineEnd.x}
          y1={start.y}
          y2={arrow.lineEnd.y}
        />
        <polygon fill={annotation.color} points={arrow.points} />
        {editable ? (
          <line
            cursor="move"
            data-test-id="dicom-annotation-hit-target"
            onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
            pointerEvents="stroke"
            stroke="transparent"
            strokeLinecap="round"
            strokeWidth={Math.max(16, strokeWidth + 12)}
            vectorEffect="non-scaling-stroke"
            x1={start.x}
            x2={arrow.end.x}
            y1={start.y}
            y2={arrow.end.y}
          />
        ) : null}
        {selected && primarySelected && editable
          ? [
              handle("start", annotation),
              handle("move", middle),
              handle("end", end),
            ]
          : null}
      </g>
    );
  }

  if (annotation.kind === "circle") {
    const bounds = {
      height: annotation.height ?? 0,
      width: annotation.width ?? 0,
      x: annotation.x,
      y: annotation.y,
    };
    const centerX = (bounds.x + bounds.width / 2) * layerSize.width;
    const centerY = (bounds.y + bounds.height / 2) * layerSize.height;
    const radiusX = (bounds.width * layerSize.width) / 2;
    const radiusY = (bounds.height * layerSize.height) / 2;
    return (
      <g>
        <ellipse
          cx={centerX}
          cy={centerY}
          data-test-id="dicom-annotation-shape-circle"
          fill="transparent"
          rx={radiusX}
          ry={radiusY}
          stroke={annotation.color}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
        />
        {editable ? (
          <ellipse
            cursor="move"
            cx={centerX}
            cy={centerY}
            fill="transparent"
            onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
            pointerEvents="all"
            rx={radiusX}
            ry={radiusY}
            stroke="transparent"
            strokeWidth={Math.max(16, strokeWidth + 12)}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {selected ? (
          <rect
            data-test-id="dicom-annotation-selection"
            fill="transparent"
            height={bounds.height * layerSize.height}
            pointerEvents="none"
            stroke={annotation.color}
            strokeOpacity={0.42}
            strokeWidth={Math.max(3, strokeWidth + 4)}
            vectorEffect="non-scaling-stroke"
            width={bounds.width * layerSize.width}
            x={bounds.x * layerSize.width}
            y={bounds.y * layerSize.height}
          />
        ) : null}
        {selected && primarySelected && editable
          ? cornerHandles(bounds, handle)
          : null}
      </g>
    );
  }

  if (annotation.kind === "text") {
    const bounds = textBounds(annotation, layerSize);
    return (
      <g>
        <text
          data-test-id="dicom-annotation-shape-text"
          fill={annotation.color}
          fontSize={annotation.fontSize}
          fontWeight={700}
          onClick={(event) => {
            if (event.detail >= 2) {
              event.stopPropagation();
              onTextEdit(annotation);
            }
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onTextEdit(annotation);
          }}
          paintOrder="stroke"
          stroke="rgba(0,0,0,0.72)"
          strokeWidth={Math.max(2, annotation.thickness)}
          vectorEffect="non-scaling-stroke"
          x={start.x}
          y={start.y}
        >
          {annotation.text || "Text"}
        </text>
        {editable ? (
          <rect
            cursor="move"
            data-test-id="dicom-annotation-text-hit-target"
            fill="transparent"
            height={bounds.height * layerSize.height}
            onClick={(event) => {
              if (event.detail >= 2) {
                event.stopPropagation();
                onTextEdit(annotation);
              }
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onTextEdit(annotation);
            }}
            onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
            pointerEvents="all"
            stroke="transparent"
            width={bounds.width * layerSize.width}
            x={bounds.x * layerSize.width}
            y={bounds.y * layerSize.height}
          />
        ) : null}
        {selected ? (
          <rect
            data-test-id="dicom-annotation-selection"
            fill="transparent"
            height={bounds.height * layerSize.height}
            pointerEvents="none"
            stroke={annotation.color}
            strokeOpacity={0.42}
            strokeWidth={Math.max(3, annotation.thickness + 4)}
            vectorEffect="non-scaling-stroke"
            width={bounds.width * layerSize.width}
            x={bounds.x * layerSize.width}
            y={bounds.y * layerSize.height}
          />
        ) : null}
        {selected && primarySelected && editable
          ? handle("move", annotation)
          : null}
      </g>
    );
  }

  const bounds = {
    height: annotation.height ?? 0,
    width: annotation.width ?? 0,
    x: annotation.x,
    y: annotation.y,
  };
  const rectX = bounds.x * layerSize.width;
  const rectY = bounds.y * layerSize.height;
  const rectWidth = bounds.width * layerSize.width;
  const rectHeight = bounds.height * layerSize.height;
  return (
    <g>
      <rect
        data-test-id="dicom-annotation-shape-box"
        fill="transparent"
        height={rectHeight}
        stroke={annotation.color}
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
        width={rectWidth}
        x={rectX}
        y={rectY}
      />
      {editable ? (
        <rect
          cursor="move"
          fill="transparent"
          height={rectHeight}
          onPointerDown={(event) => onStartEditDrag(event, annotation, "move")}
          pointerEvents="all"
          stroke="transparent"
          strokeWidth={Math.max(16, strokeWidth + 12)}
          vectorEffect="non-scaling-stroke"
          width={rectWidth}
          x={rectX}
          y={rectY}
        />
      ) : null}
      {selected ? (
        <rect
          data-test-id="dicom-annotation-selection"
          fill="transparent"
          height={rectHeight}
          pointerEvents="none"
          stroke={annotation.color}
          strokeOpacity={0.42}
          strokeWidth={Math.max(3, strokeWidth + 4)}
          vectorEffect="non-scaling-stroke"
          width={rectWidth}
          x={rectX}
          y={rectY}
        />
      ) : null}
      {selected && primarySelected && editable
        ? cornerHandles(bounds, handle)
        : null}
    </g>
  );
}

function cornerHandles(
  bounds: RectBounds,
  render: (mode: EditHandle, point: Point) => ReactNode,
) {
  return [
    render("nw", { x: bounds.x, y: bounds.y }),
    render("ne", { x: bounds.x + bounds.width, y: bounds.y }),
    render("sw", { x: bounds.x, y: bounds.y + bounds.height }),
    render("se", {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    }),
  ];
}

function AnnotationHandle({
  active,
  layerSize,
  mode,
  onPointerDown,
  point,
}: {
  active: boolean;
  layerSize: LayerSize;
  mode: EditHandle;
  onPointerDown: (event: PointerEvent<SVGCircleElement>) => void;
  point: Point;
}) {
  const handlePoint = svgPoint(point, layerSize);
  return (
    <g>
      {active ? (
        <circle
          cx={handlePoint.x}
          cy={handlePoint.y}
          data-test-id={`dicom-annotation-handle-${mode}-active`}
          fill={HANDLE_ACTIVE_FILL_COLOR}
          opacity={0.72}
          pointerEvents="none"
          r={19}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <circle
        className={active ? "cursor-grabbing" : "cursor-grab"}
        cx={handlePoint.x}
        cy={handlePoint.y}
        data-active={active ? "true" : undefined}
        data-test-id={`dicom-annotation-handle-${mode}`}
        fill={HANDLE_FILL_COLOR}
        onPointerDown={onPointerDown}
        r={7}
        stroke={HANDLE_STROKE_COLOR}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

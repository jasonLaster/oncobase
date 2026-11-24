"use client";

import { buttonClassName, cn } from "./ui.tsx";
import { RangeSlider } from "./viewer-controls.tsx";

import {
  annotationColors,
  annotationKindLabel,
  type AnnotationKind,
} from "./dicom-annotation-model.ts";

/** Classes for the annotation toolbar's Select toggle and Draw menu trigger. */
export function annotationToolbarButtonClassName({ withMenu = false } = {}) {
  return buttonClassName(
    { size: "icon-sm", variant: "outline" },
    "h-8 rounded-md border-white/15 bg-white/5 px-0 text-xs text-zinc-300 hover:bg-white/10",
    withMenu ? "w-10" : "w-8",
    "aria-pressed:border-sky-300/60 aria-pressed:bg-sky-300/20 aria-pressed:text-sky-50",
    "aria-disabled:pointer-events-none aria-disabled:opacity-50",
  );
}

export function AnnotationEditorRail({
  activeColor,
  activeFontSize,
  activeText,
  activeThickness,
  disabled,
  kind,
  onChooseColor,
  onChooseFontSize,
  onChooseText,
  onChooseThickness,
}: {
  activeColor: string;
  activeFontSize: number;
  activeText: string;
  activeThickness: number;
  disabled?: boolean;
  kind: AnnotationKind;
  onChooseColor: (color: string) => void;
  onChooseFontSize: (fontSize: number) => void;
  onChooseText: (text: string) => void;
  onChooseThickness: (thickness: number) => void;
}) {
  const label = annotationKindLabel(kind);
  return (
    <div className="space-y-5" data-test-id="dicom-annotation-style-panel">
      <section>
        <div className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">
          Annotation
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm text-zinc-100">
          <span
            className="size-3 rounded-full border border-white/20"
            style={{ backgroundColor: activeColor }}
          />
          <span>{label}</span>
        </div>
      </section>

      <AnnotationStyleControls
        activeColor={activeColor}
        activeFontSize={activeFontSize}
        activeThickness={activeThickness}
        disabled={disabled}
        onChooseColor={onChooseColor}
        onChooseFontSize={onChooseFontSize}
        onChooseThickness={onChooseThickness}
        rail
        showFontSize={kind === "text"}
      />

      {kind === "text" ? (
        <label className="grid gap-2 text-xs text-zinc-300">
          <span className="font-medium">Text</span>
          <input
            aria-label="Annotation text"
            className="h-9 rounded-md border border-white/15 bg-black/35 px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-sky-300/70"
            data-test-id="dicom-annotation-text"
            disabled={disabled}
            onChange={(event) => onChooseText(event.currentTarget.value)}
            value={activeText}
          />
        </label>
      ) : null}
    </div>
  );
}

export function AnnotationSelectionRail({
  activeColor,
  activeThickness,
  disabled,
  onChooseColor,
  onChooseThickness,
  selectedCount,
}: {
  activeColor: string;
  activeThickness: number;
  disabled?: boolean;
  onChooseColor: (color: string) => void;
  onChooseThickness: (thickness: number) => void;
  selectedCount: number;
}) {
  return (
    <div className="space-y-5" data-test-id="dicom-annotation-style-panel">
      <section>
        <div className="text-xs font-semibold tracking-wide text-zinc-300 uppercase">
          Selection
        </div>
        <div className="mt-2 text-sm text-zinc-100">
          {selectedCount} annotations
        </div>
      </section>

      <AnnotationStyleControls
        activeColor={activeColor}
        activeFontSize={22}
        activeThickness={activeThickness}
        disabled={disabled}
        onChooseColor={onChooseColor}
        onChooseFontSize={() => undefined}
        onChooseThickness={onChooseThickness}
        rail
        showFontSize={false}
      />
    </div>
  );
}

function AnnotationStyleControls({
  activeColor,
  activeFontSize,
  activeThickness,
  disabled,
  onChooseColor,
  onChooseFontSize,
  onChooseThickness,
  rail,
  showFontSize,
}: {
  activeColor: string;
  activeFontSize: number;
  activeThickness: number;
  disabled?: boolean;
  onChooseColor: (color: string) => void;
  onChooseFontSize: (fontSize: number) => void;
  onChooseThickness: (thickness: number) => void;
  rail: boolean;
  showFontSize: boolean;
}) {
  return (
    <div className={cn(rail ? "space-y-5" : "grid gap-2")}>
      <div
        aria-label="Annotation colors"
        className={cn(rail ? "grid grid-cols-4 gap-3" : "flex flex-wrap gap-1")}
      >
        {annotationColors.map((candidate) => (
          <button
            aria-label={`Color ${candidate}`}
            className={cn(
              rail
                ? "size-10 rounded-xl border border-white/10 bg-white/[0.04] p-1.5"
                : "size-6 rounded border border-white/20",
              candidate === activeColor &&
                (rail
                  ? "bg-white/15 ring-2 ring-sky-300/80"
                  : "ring-2 ring-white/75 ring-offset-1 ring-offset-black"),
            )}
            data-test-id={`dicom-annotation-color-${candidate.slice(1)}`}
            disabled={disabled}
            key={candidate}
            onClick={() => onChooseColor(candidate)}
            type="button"
          >
            <span
              className="block size-full rounded-full border border-black/20"
              style={{ backgroundColor: candidate }}
            />
          </button>
        ))}
      </div>

      <label className={cn("grid gap-2", rail ? "text-xs text-zinc-300" : "")}>
        {rail ? <span className="font-medium">Thickness</span> : null}
        <RangeSlider
          accent="sky"
          disabled={disabled}
          label="Annotation thickness"
          max={12}
          min={1}
          onValueChange={onChooseThickness}
          testId="dicom-annotation-thickness"
          title="Thickness"
          value={activeThickness}
        />
      </label>

      {showFontSize ? (
        <label className={cn("grid gap-2", rail ? "text-xs text-zinc-300" : "")}>
          {rail ? <span className="font-medium">Font size</span> : null}
          <RangeSlider
            accent="sky"
            disabled={disabled}
            label="Annotation font size"
            max={48}
            min={12}
            onValueChange={onChooseFontSize}
            testId="dicom-annotation-font-size"
            title="Font size"
            value={activeFontSize}
          />
        </label>
      ) : null}
    </div>
  );
}

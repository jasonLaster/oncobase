"use client";

import { Move, SlidersHorizontal, ZoomIn } from "lucide-react";
import type { ReactNode } from "react";

import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from "@oncobase/ui/slider";
import { Toggle, ToggleGroup } from "@oncobase/ui/toggle";

import { buttonClassName, cn } from "./ui.tsx";

export type ToolMode = "window" | "pan" | "zoom";

const toolModes: Array<{ icon: ReactNode; label: string; value: ToolMode }> = [
  { icon: <SlidersHorizontal className="size-4" />, label: "W/L", value: "window" },
  { icon: <Move className="size-4" />, label: "Pan", value: "pan" },
  { icon: <ZoomIn className="size-4" />, label: "Zoom", value: "zoom" },
];

/**
 * W/L, Pan and Zoom: one pressed at a time. Pressing Pan or Zoom again
 * clears the group, which falls back to window-level.
 */
export function ToolModeGroup({
  onToolModeChange,
  toolMode,
}: {
  onToolModeChange: (mode: ToolMode) => void;
  toolMode: ToolMode;
}) {
  return (
    <ToggleGroup
      aria-label="Pointer tool"
      className="flex shrink-0 items-center gap-1"
      onValueChange={(next) => onToolModeChange((next[0] as ToolMode | undefined) ?? "window")}
      value={[toolMode]}
    >
      {toolModes.map((mode) => (
        <Toggle
          aria-label={mode.label}
          className={buttonClassName(
            { size: "sm", variant: "outline" },
            "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10",
            "data-pressed:border-emerald-300/50 data-pressed:bg-emerald-300/15 data-pressed:text-emerald-100",
          )}
          key={mode.value}
          value={mode.value}
        >
          {mode.icon}
          <span className="sr-only sm:not-sr-only">{mode.label}</span>
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/**
 * Viewer arrow and Space shortcuts stay out of the way while a control has
 * focus, so toolbars, sliders and splitters keep their own keys.
 */
export function focusAllowsViewerShortcut() {
  const target = document.activeElement;
  return !(
    target instanceof HTMLElement &&
    (target.closest(
      "a, button, input, select, textarea, [role='separator'], [role='slider'], [role='toolbar'], [role='menu']",
    ) ||
      target.isContentEditable)
  );
}

const sliderAccents = {
  emerald: { fill: "bg-emerald-300", ring: "has-[:focus-visible]:ring-emerald-300/70" },
  sky: { fill: "bg-sky-300", ring: "has-[:focus-visible]:ring-sky-300/70" },
} as const;

/** A one-thumb Slider styled like the viewer's old native range inputs. */
export function RangeSlider({
  accent = "emerald",
  className,
  disabled,
  label,
  max,
  min,
  onValueChange,
  testId,
  title,
  value,
  valueText,
}: {
  accent?: keyof typeof sliderAccents;
  className?: string;
  disabled?: boolean;
  label: string;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  testId?: string;
  title?: string;
  value: number;
  valueText?: (value: number) => string;
}) {
  const colors = sliderAccents[accent];
  return (
    <Slider
      className={cn("w-full data-disabled:opacity-50", className)}
      data-test-id={testId}
      disabled={disabled}
      format={valueText}
      max={max}
      min={min}
      onValueChange={(next) => onValueChange(next as number)}
      title={title}
      value={value}
    >
      <SliderControl className="flex h-4 w-full cursor-pointer items-center data-disabled:cursor-default">
        <SliderTrack className="h-1.5 w-full rounded-full bg-white/20">
          <SliderIndicator className={cn("h-full rounded-full", colors.fill)} />
          <SliderThumb
            aria-label={label}
            className={cn("size-3.5 rounded-full shadow ring-offset-1 ring-offset-black has-[:focus-visible]:ring-2", colors.fill, colors.ring)}
          />
        </SliderTrack>
      </SliderControl>
    </Slider>
  );
}

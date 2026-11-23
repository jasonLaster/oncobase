import { useState, type CSSProperties, type ReactNode } from "react";
import { Checkbox, CheckboxIndicator } from "@oncobase/ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@oncobase/ui/collapsible";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
} from "@oncobase/ui/slider";

type DrawerProps = {
  title: ReactNode;
  meta: ReactNode;
  allOpen: boolean;
  children: ReactNode;
};

export function CelDrawer({ title, meta, allOpen, children }: DrawerProps) {
  const [open, setOpen] = useState(allOpen);
  const [syncedAllOpen, setSyncedAllOpen] = useState(allOpen);
  if (syncedAllOpen !== allOpen) {
    setSyncedAllOpen(allOpen);
    setOpen(allOpen);
  }

  return (
    <Collapsible className="cel-drawer" open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="cel-drawer-trigger">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span className="cel-chev" aria-hidden="true">▶</span> {title}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>{meta}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel className="cel-drawer-body" hiddenUntilFound>
        {children}
      </CollapsiblePanel>
    </Collapsible>
  );
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onValueChange: (value: number) => void;
  style?: CSSProperties;
};

export function CelSlider({ label, value, min, max, step, format, onValueChange, style }: SliderProps) {
  return (
    <Slider
      className="cel-range"
      style={style}
      value={value}
      min={min}
      max={max}
      step={step}
      format={format}
      onValueChange={(next) => onValueChange(next)}
    >
      <SliderControl className="cel-range-control">
        <SliderTrack className="cel-range-track">
          <SliderIndicator className="cel-range-indicator" />
          <SliderThumb className="cel-range-thumb" aria-label={label} />
        </SliderTrack>
      </SliderControl>
    </Slider>
  );
}

type CheckboxProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  style?: CSSProperties;
};

export function CelCheckbox({ checked, onCheckedChange, children, style }: CheckboxProps) {
  return (
    <label style={style}>
      <Checkbox
        className="cel-check"
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
      >
        <CheckboxIndicator className="cel-check-indicator" aria-hidden="true">
          ✓
        </CheckboxIndicator>
      </Checkbox>
      {children}
    </label>
  );
}

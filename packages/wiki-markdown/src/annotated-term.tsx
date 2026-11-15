"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";

export type AnnotatedTermProps = ComponentProps<"abbr"> & {
  "data-tooltip"?: string;
  "data-name"?: string;
  "data-category"?: string;
  "data-target"?: string;
  "data-effect"?: string;
};

type TooltipModule = typeof import("./annotated-term-tooltip.tsx");
// The tooltip library (and floating-ui) is about 38 KB gzip that most articles
// never use. It loads after the article paints, when the first drug term renders.
let tooltipModule: TooltipModule | null = null;
let tooltipLoad: Promise<TooltipModule> | null = null;
const loadTooltip = () => (tooltipLoad ??= import("./annotated-term-tooltip.tsx").then(module => (tooltipModule = module)));

/** Authored explanations stay in the document, not in a site-specific drug dictionary. */
export function AnnotatedTerm({ children, title, ...props }: AnnotatedTermProps) {
  const [loaded, setLoaded] = useState<TooltipModule | null>(tooltipModule);
  // What the reader did to the placeholder before the tooltip arrived, handed to the real badge.
  const wantsOpen = useRef(false);
  const placeholder = useRef<HTMLButtonElement>(null);
  const [handoff, setHandoff] = useState({ open: false, focus: false });
  const isDrug = props["data-tooltip"] === "drug" && Boolean(title);

  useEffect(() => {
    if (!isDrug || loaded) return;
    let live = true;
    void loadTooltip().then((module) => {
      if (!live) return;
      setHandoff({ open: wantsOpen.current, focus: document.activeElement === placeholder.current });
      setLoaded(module);
    });
    return () => { live = false; };
  }, [isDrug, loaded]);

  if (!isDrug) return <abbr title={title} {...props}>{children}</abbr>;
  if (loaded) {
    const { DrugTermTooltip } = loaded;
    return <DrugTermTooltip title={title!} initialOpen={handoff.open} keepFocus={handoff.focus} {...props}>{children}</DrugTermTooltip>;
  }
  // The same badge without its tooltip: no layout shift, and the name is still announced.
  const intend = (open: boolean) => () => { wantsOpen.current = open; };
  return (
    <button
      ref={placeholder}
      type="button"
      className="wiki-drug-badge"
      aria-label={`About ${props["data-name"] || String(children)}`}
      onPointerEnter={intend(true)}
      onPointerLeave={intend(false)}
      onFocus={intend(true)}
      onBlur={intend(false)}
      onClick={intend(true)}
    >
      {children}
    </button>
  );
}

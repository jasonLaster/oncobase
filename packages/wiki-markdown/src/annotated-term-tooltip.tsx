"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import type { AnnotatedTermProps } from "./annotated-term.tsx";

/** The drug badge with its tooltip. Loaded on demand by AnnotatedTerm: the tooltip library is not needed to paint an article. */
export function DrugTermTooltip({ children, title, initialOpen = false, keepFocus = false, ...props }: AnnotatedTermProps & {
  title: string;
  /** The reader hovered, focused or clicked the placeholder before this loaded. */
  initialOpen?: boolean;
  /** The placeholder had focus; keep it on the badge. */
  keepFocus?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  // Once, on arrival: the placeholder this replaced was focused.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (keepFocus) trigger.current?.focus({ preventScroll: true }); }, []);

  return (
    <Tooltip open={open} onOpenChange={setOpen} delay={250} closeOnPress={false} toggleable>
      <TooltipTrigger
        className="wiki-drug-badge"
        type="button"
        ref={trigger}
        aria-label={`About ${props["data-name"] || String(children)}`}
      >
        {children}
      </TooltipTrigger>
      {/* Spans: the content renders in place, and a drug term often sits inside a <p>. */}
      <TooltipContent className="wiki-drug-tooltip" render={<span />} side="top" sideOffset={8} collisionPadding={8}>
        <TooltipArrow className="wiki-drug-tooltip__arrow" render={<span />} />
        {props["data-category"] && <span className="wiki-drug-tooltip__category">{props["data-category"]}</span>}
        <span className="wiki-drug-tooltip__name">{props["data-name"] || children}</span>
        {props["data-target"] && props["data-effect"] && (
          <span className="wiki-drug-tooltip__pathway">
            <span>{props["data-target"]}</span>
            <span aria-hidden="true">→</span>
            <span>{props["data-effect"]}</span>
          </span>
        )}
        <span className="wiki-drug-tooltip__description">{title}</span>
      </TooltipContent>
    </Tooltip>
  );
}

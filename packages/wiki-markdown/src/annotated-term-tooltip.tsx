"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AnnotatedTermProps } from "./annotated-term.tsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

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
  const tooltipId = useId();

  return (
    <TooltipProvider delay={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          className="wiki-drug-badge"
          type="button"
          closeOnClick={false}
          ref={trigger}
          onClick={() => setOpen(true)}
          aria-label={`About ${props["data-name"] || String(children)}`}
          aria-describedby={open ? tooltipId : undefined}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent id={tooltipId} role="tooltip" className="wiki-drug-tooltip" side="top" sideOffset={8}>
          {props["data-category"] && <div className="wiki-drug-tooltip__category">{props["data-category"]}</div>}
          <div className="wiki-drug-tooltip__name">{props["data-name"] || children}</div>
          {props["data-target"] && props["data-effect"] && (
            <div className="wiki-drug-tooltip__pathway">
              <span>{props["data-target"]}</span>
              <span aria-hidden="true">→</span>
              <span>{props["data-effect"]}</span>
            </div>
          )}
          <p className="wiki-drug-tooltip__description">{title}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

"use client";

import { useId, useState, type ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type AnnotatedTermProps = ComponentProps<"abbr"> & {
  "data-tooltip"?: string;
  "data-name"?: string;
  "data-category"?: string;
  "data-target"?: string;
  "data-effect"?: string;
};

/** Authored explanations stay in the document, not in a site-specific drug dictionary. */
export function AnnotatedTerm({ children, title, ...props }: AnnotatedTermProps) {
  const [open, setOpen] = useState(false);
  const tooltipId = useId();
  if (props["data-tooltip"] !== "drug" || !title) {
    return <abbr title={title} {...props}>{children}</abbr>;
  }

  return (
    <TooltipProvider delay={250}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          className="wiki-drug-badge"
          type="button"
          closeOnClick={false}
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

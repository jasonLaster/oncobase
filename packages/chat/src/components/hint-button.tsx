"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@oncobase/ui/tooltip";
import type { ComponentProps, ReactNode } from "react";

export type HintButtonProps = Omit<ComponentProps<typeof TooltipTrigger>, "children"> & {
  hint: ReactNode;
  children?: ReactNode;
  // false keeps the hint open on press, for a hint that changes, like Copy turning into Copied.
  closeOnPress?: boolean;
  onHintClosed?: () => void;
};

export function HintButton({ hint, children, closeOnPress, onHintClosed, ...props }: HintButtonProps) {
  return (
    <Tooltip
      closeOnPress={closeOnPress}
      onOpenChangeComplete={(open) => {
        if (!open) onHintClosed?.();
      }}
    >
      <TooltipTrigger type="button" {...props}>
        {children}
      </TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        className="pointer-events-none max-w-xs rounded-md bg-[var(--foreground)] px-2 py-1 text-xs text-[var(--background)] shadow-md"
      >
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

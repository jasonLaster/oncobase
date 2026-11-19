"use client";

import * as React from "react";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { cn } from "./cn";
import type { SmartTableLayoutAdapter } from "./layout-adapter";
import type { SmartTableToggleLabels } from "./toggle-labels";

function assignRef<T>(
  ref: React.ForwardedRef<T>,
  value: T | null
) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

export const SmartTable = React.forwardRef<
  HTMLTableElement,
  React.ComponentPropsWithoutRef<"table"> & {
    persistenceKey?: string;
    layoutAdapter?: SmartTableLayoutAdapter;
    shellClassName?: string;
    wrapperClassName?: string;
    toggleLabels?: Partial<SmartTableToggleLabels>;
  }
>(
  (
    {
      className,
      persistenceKey,
      layoutAdapter,
      shellClassName,
      wrapperClassName,
      toggleLabels,
      ...props
    },
    forwardedRef
  ) => {
    const tableRef = React.useRef<HTMLTableElement>(null);

    const setTableRef = React.useCallback(
      (node: HTMLTableElement | null) => {
        tableRef.current = node;
        assignRef(forwardedRef, node);
      },
      [forwardedRef]
    );

    React.useEffect(() => {
      const table = tableRef.current;
      if (!table) {
        return;
      }

      let active = true;
      let cleanup: (() => void) | undefined;
      void import("./enhance-table").then(({ enhanceSmartTableElement }) => {
        if (active) {
          cleanup = enhanceSmartTableElement(table, { persistenceKey, layoutAdapter, toggleLabels }).cleanup;
        }
      }).catch(() => { /* Native table layout and scrolling remain available. */ });

      return () => {
        active = false;
        cleanup?.();
      };
    }, [persistenceKey, layoutAdapter, toggleLabels]);

    return (
      <div
        data-smart-table-shell
        className={cn("smart-table-shell", shellClassName)}
      >
        <div
          data-smart-table-wrapper
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Native horizontal scrolling must be keyboard reachable.
          tabIndex={0}
          className={cn(
            "smart-table-wrapper table-scroll-wrapper",
            wrapperClassName
          )}
        >
          <table
            ref={setTableRef}
            data-smart-table
            className={cn("smart-table", className)}
            {...props}
          />
        </div>
      </div>
    );
  }
);
SmartTable.displayName = "SmartTable";

export const SmartTableHeader = TableHeader;
export const SmartTableBody = TableBody;
export const SmartTableRow = TableRow;
export const SmartTableHead = TableHead;
export const SmartTableCell = TableCell;

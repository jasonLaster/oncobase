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
import {
  defaultSmartTableLayoutAdapter,
  type SmartTableLayoutAdapter,
} from "./layout-adapter";
import {
  enhanceSmartTableElement,
  type SmartTableToggleLabels,
} from "./enhance-table";

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
      layoutAdapter = defaultSmartTableLayoutAdapter,
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

    React.useLayoutEffect(() => {
      const table = tableRef.current;
      if (!table) {
        return;
      }

      return enhanceSmartTableElement(table, {
        persistenceKey,
        layoutAdapter,
        toggleLabels,
      }).cleanup;
    }, [persistenceKey, layoutAdapter, toggleLabels]);

    return (
      <div
        data-smart-table-shell
        className={cn("smart-table-shell", shellClassName)}
      >
        <div
          data-smart-table-wrapper
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

"use client";

import { useLayoutEffect, useRef } from "react";
import {
  defaultSmartTableLayoutAdapter,
  type SmartTableLayoutAdapter,
} from "./layout-adapter";
import {
  enhanceSmartTableElement,
  type SmartTableToggleLabels,
} from "./enhance-table";

/**
 * Client island that progressively enhances already-rendered HTML tables by
 * wrapping them with the smart-table affordances.
 */
export function SmartTableEnhancer({
  layoutAdapter = defaultSmartTableLayoutAdapter,
  getPersistenceKey,
  toggleLabels,
}: {
  layoutAdapter?: SmartTableLayoutAdapter;
  getPersistenceKey?: (context: {
    table: HTMLTableElement;
    index: number;
  }) => string | undefined;
  toggleLabels?: Partial<SmartTableToggleLabels>;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = sentinelRef.current?.parentElement;
    if (!container) {
      return;
    }

    const cleanups: Array<() => void> = [];
    const tables = container.querySelectorAll<HTMLTableElement>("table");

    tables.forEach((table, index) => {
      const persistenceKey = getPersistenceKey?.({ table, index }) ?? undefined;
      const { cleanup } = enhanceSmartTableElement(table, {
        persistenceKey,
        layoutAdapter,
        toggleLabels,
      });
      cleanups.push(cleanup);
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [getPersistenceKey, layoutAdapter, toggleLabels]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

/**
 * Backwards-compatible alias. Prefer `SmartTableEnhancer` in new integrations.
 */
export const InteractiveTables = SmartTableEnhancer;

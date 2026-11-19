"use client";

import { useEffect, useRef } from "react";
import type { SmartTableLayoutAdapter } from "./layout-adapter";
import type { SmartTableToggleLabels } from "./toggle-labels";

/**
 * Client island that progressively enhances already-rendered HTML tables by
 * wrapping them with the smart-table affordances.
 */
export function SmartTableEnhancer({
  layoutAdapter,
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

  useEffect(() => {
    const container = sentinelRef.current?.parentElement;
    if (!container) {
      return;
    }

    const tables = container.querySelectorAll<HTMLTableElement>("table");
    if (tables.length === 0) return;

    let active = true;
    const cleanups: Array<() => void> = [];
    void import("./enhance-table").then(({ enhanceSmartTableElement }) => {
      if (!active) return;
      tables.forEach((table, index) => {
        if (!container.contains(table)) return;
        const persistenceKey = getPersistenceKey?.({ table, index });
        const { cleanup } = enhanceSmartTableElement(table, { persistenceKey, layoutAdapter, toggleLabels });
        cleanups.push(cleanup);
      });
    }).catch(() => { /* The rendered HTML tables remain available. */ });

    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [getPersistenceKey, layoutAdapter, toggleLabels]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

/**
 * Backwards-compatible alias. Prefer `SmartTableEnhancer` in new integrations.
 */
export const InteractiveTables = SmartTableEnhancer;

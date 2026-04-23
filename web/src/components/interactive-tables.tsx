"use client";

import { SmartTableEnhancer } from "@diana-tnbc/smart-table";
import { dianaSmartTableLayoutAdapter } from "@/lib/smart-table-layout-adapter";

export function InteractiveTables() {
  return (
    <SmartTableEnhancer
      layoutAdapter={dianaSmartTableLayoutAdapter}
      getPersistenceKey={({ index }) =>
        `${window.location.pathname}::prose-table-${index}`
      }
    />
  );
}

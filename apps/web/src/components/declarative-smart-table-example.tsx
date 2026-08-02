"use client";

import { DeclarativeSmartTableShowcase } from "@oncobase/smart-table";
import { webSmartTableLayoutAdapter } from "@/lib/smart-table-layout-adapter";

export function DeclarativeSmartTableExample() {
  return (
    <DeclarativeSmartTableShowcase layoutAdapter={webSmartTableLayoutAdapter} />
  );
}

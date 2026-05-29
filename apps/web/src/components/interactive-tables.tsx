"use client";

import { WikiMarkdownTableEnhancer } from "@oncobase/wiki-markdown";
import { usePathname } from "next/navigation";
import { webSmartTableLayoutAdapter } from "@/lib/smart-table-layout-adapter";

export function InteractiveTables() {
  const pathname = usePathname();

  return (
    <WikiMarkdownTableEnhancer
      layoutAdapter={webSmartTableLayoutAdapter}
      persistenceScope={pathname}
    />
  );
}

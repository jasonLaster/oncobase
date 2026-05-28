"use client";

import { WikiMarkdownTableEnhancer } from "@diana-tnbc/wiki-markdown";
import { usePathname } from "next/navigation";
import { dianaSmartTableLayoutAdapter } from "@/lib/smart-table-layout-adapter";

export function InteractiveTables() {
  const pathname = usePathname();

  return (
    <WikiMarkdownTableEnhancer
      layoutAdapter={dianaSmartTableLayoutAdapter}
      persistenceScope={pathname}
    />
  );
}

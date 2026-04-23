"use client";

import { useId } from "react";
import { usePathname } from "next/navigation";
import {
  SmartTable,
  SmartTableBody,
  SmartTableCell,
  SmartTableHead,
  SmartTableHeader,
  SmartTableRow,
} from "@diana-tnbc/smart-table";
import { dianaSmartTableLayoutAdapter } from "@/lib/smart-table-layout-adapter";

export function MdTable(props: React.ComponentProps<typeof SmartTable>) {
  const id = useId();
  const pathname = usePathname();

  return (
    <SmartTable
      layoutAdapter={dianaSmartTableLayoutAdapter}
      persistenceKey={`${pathname}::md-table-${id}`}
      {...props}
    />
  );
}

export function MdThead(props: React.ComponentProps<typeof SmartTableHeader>) {
  return <SmartTableHeader {...props} />;
}

export function MdTbody(props: React.ComponentProps<typeof SmartTableBody>) {
  return <SmartTableBody {...props} />;
}

export function MdTr(props: React.ComponentProps<typeof SmartTableRow>) {
  return <SmartTableRow {...props} />;
}

export function MdTh(props: React.ComponentProps<typeof SmartTableHead>) {
  return <SmartTableHead {...props} />;
}

export function MdTd(props: React.ComponentProps<typeof SmartTableCell>) {
  return <SmartTableCell {...props} />;
}

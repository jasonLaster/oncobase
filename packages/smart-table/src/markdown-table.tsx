"use client";

import {
  SmartTable,
  SmartTableBody,
  SmartTableCell,
  SmartTableHead,
  SmartTableHeader,
  SmartTableRow,
} from "./smart-table";

export function MdTable(props: React.ComponentProps<typeof SmartTable>) {
  return <SmartTable {...props} />;
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

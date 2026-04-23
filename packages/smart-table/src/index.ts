"use client";

import "./styles.css";

export {
  SmartTable,
  SmartTableBody,
  SmartTableCell,
  SmartTableHead,
  SmartTableHeader,
  SmartTableRow,
} from "./smart-table";
export {
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
} from "./markdown-table";
export {
  SmartTableEnhancer,
  InteractiveTables,
} from "./interactive-tables";
export {
  defaultSmartTableToggleLabels,
  type SmartTableToggleLabels,
} from "./enhance-table";
export {
  createViewportSmartTableLayoutAdapter,
  defaultSmartTableLayoutAdapter,
  getDefaultVerticalScrollContainer,
  type SmartTableBleed,
  type SmartTableLayoutAdapter,
  type SmartTableOverlayLayout,
} from "./layout-adapter";

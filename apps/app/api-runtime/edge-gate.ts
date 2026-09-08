import { createReaderEdgeGate } from "../server/reader-edge-gate";
declare const __WIKI_STATIC_READER_PREFIXES__: string[];
export default createReaderEdgeGate(undefined,
  typeof __WIKI_STATIC_READER_PREFIXES__ === "undefined" ? [] : __WIKI_STATIC_READER_PREFIXES__);

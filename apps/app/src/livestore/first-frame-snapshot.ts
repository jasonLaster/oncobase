import { markVisualPhase } from "../visual-phase";

// The first-frame HTML snapshot is retired: nothing writes or reads it, and
// main.tsx deletes old `wiki-vite:first-frame:*` keys on load. This removes
// a stale snapshot node (and its document flags) if an old cached shell
// still carries one; see bootstrap/CACHE-LAYERS.md.
export function dismissFirstFrameSnapshot(documentNode: Document = document) {
  if (documentNode.documentElement.dataset.wikiFirstFrame) markVisualPhase("snapshot-dismiss");
  documentNode.getElementById("wiki-first-frame-snapshot")?.remove();
  delete documentNode.documentElement.dataset.wikiFirstFrame;
  delete documentNode.documentElement.dataset.wikiFirstFrameVersion;
}

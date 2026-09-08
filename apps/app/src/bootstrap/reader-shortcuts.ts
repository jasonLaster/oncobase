import type { CommandPaletteChordController, createCommandPaletteChords } from "@oncobase/wiki-shell";

type StartupPaletteMode = "pages" | "outline" | "actions";

declare global {
  interface Window {
    __wikiReaderShortcuts?: {
      controller: CommandPaletteChordController;
      pending: StartupPaletteMode | null;
    };
  }
}

/** Serialized into the document head, before streamed content can be read. */
export function installReaderShortcuts(create: typeof createCommandPaletteChords) {
  const state = {
    pending: null as StartupPaletteMode | null,
    controller: null as CommandPaletteChordController | null,
  };
  const queue = (mode: StartupPaletteMode) => {
    state.pending = mode;
  };
  state.controller = create({
    onFiles: () => queue("pages"),
    onOutline: () => queue("outline"),
    onAction: () => queue("actions"),
    onCancel: () => { state.pending = null; },
  });
  window.__wikiReaderShortcuts = state as NonNullable<Window["__wikiReaderShortcuts"]>;
}

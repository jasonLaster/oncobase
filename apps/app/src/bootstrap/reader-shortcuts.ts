import type { CommandPaletteChordController, createCommandPaletteChords } from "@oncobase/wiki-shell";

type StartupReaderAction = "pages" | "outline" | "actions" | "signin";

declare global {
  interface Window {
    __wikiReaderShortcuts?: {
      controller: CommandPaletteChordController;
      pending: StartupReaderAction | null;
    };
  }
}

/** Serialized into every reader document head, before app scripts or snapshots. */
export function installReaderShortcuts(create: typeof createCommandPaletteChords) {
  // These routes intentionally do not mount the reader's palette host.
  if (["/login", "/terms-and-conditions", "/tools/dicom-viewer", "/tools/dicom-compare"].includes(window.location?.pathname)) return;
  if (window.__wikiReaderShortcuts) return;
  const state = {
    pending: null as StartupReaderAction | null,
    controller: null as CommandPaletteChordController | null,
  };
  const queue = (mode: StartupReaderAction) => {
    state.pending = mode;
  };
  state.controller = create({
    onFiles: () => queue("pages"),
    onOutline: () => queue("outline"),
    onAction: () => queue("actions"),
    onSignIn: () => queue("signin"),
    onCancel: () => { state.pending = null; },
  });
  window.__wikiReaderShortcuts = state as NonNullable<Window["__wikiReaderShortcuts"]>;
}

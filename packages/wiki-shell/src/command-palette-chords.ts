const CHORD_WINDOW_MS = 600;

export type CommandPaletteChordHandlers = {
  onFiles?: () => void;
  onOutline?: () => void;
  onAction?: () => void;
};

/**
 * Install global keyboard chords for the command palette:
 * - ⌘K / Ctrl+K: chord leader; opens the file palette after CHORD_WINDOW_MS
 *   unless followed by F / O / A within the window.
 * - ⌘K F / ⌘O: file palette.
 * - ⌘K O / ⌘⇧O: outline palette.
 * - ⌘K A / ⌘⇧K: action palette.
 *
 * Returns a teardown function that removes the listener and cancels any
 * pending chord timer.
 */
export function installCommandPaletteChords(
  handlers: CommandPaletteChordHandlers,
): () => void {
  if (typeof window === "undefined") return () => {};

  let chordTimer: ReturnType<typeof setTimeout> | null = null;

  function startChord() {
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = setTimeout(() => {
      chordTimer = null;
      handlers.onFiles?.();
    }, CHORD_WINDOW_MS);
  }

  function endChord() {
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = null;
  }

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;

    if (chordTimer && !mod && !event.shiftKey && !event.altKey) {
      if (event.code === "KeyF") {
        event.preventDefault();
        event.stopPropagation();
        endChord();
        handlers.onFiles?.();
        return;
      }
      if (event.code === "KeyO") {
        event.preventDefault();
        event.stopPropagation();
        endChord();
        handlers.onOutline?.();
        return;
      }
      if (event.code === "KeyA") {
        event.preventDefault();
        event.stopPropagation();
        endChord();
        handlers.onAction?.();
        return;
      }
      endChord();
    }

    if (!mod) return;

    if (!event.shiftKey && event.code === "KeyK") {
      event.preventDefault();
      startChord();
      return;
    }

    if (!event.shiftKey && event.code === "KeyO") {
      event.preventDefault();
      handlers.onFiles?.();
      return;
    }

    if (event.shiftKey && event.code === "KeyO") {
      event.preventDefault();
      handlers.onOutline?.();
      return;
    }

    if (event.shiftKey && event.code === "KeyK") {
      event.preventDefault();
      handlers.onAction?.();
      return;
    }
  }

  document.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    document.removeEventListener("keydown", onKeyDown, { capture: true });
    endChord();
  };
}

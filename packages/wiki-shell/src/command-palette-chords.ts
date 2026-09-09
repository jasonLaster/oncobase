export type CommandPaletteChordHandlers = {
  onFiles?: () => void;
  onOutline?: () => void;
  onAction?: () => void;
  onCancel?: () => void;
};

export type CommandPaletteChordController = {
  setHandlers: (handlers: CommandPaletteChordHandlers) => void;
  dispose: () => void;
};

/**
 * Install global keyboard chords for the command palette:
 * - ⌘K / Ctrl+K: opens files immediately; F / O / A can select another
 *   palette mode within CHORD_WINDOW_MS without delaying the initial open.
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
  return createCommandPaletteChords(handlers).dispose;
}

/** Self-contained so the HTML reader can install it before application chunks.
 * Adopting handlers preserves a chord already in progress during startup. */
export function createCommandPaletteChords(
  handlers: CommandPaletteChordHandlers,
): CommandPaletteChordController {
  const CHORD_WINDOW_MS = 600;
  if (typeof window === "undefined") return { setHandlers() {}, dispose() {} };

  let chordTimer: ReturnType<typeof setTimeout> | null = null;

  function startChord() {
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = setTimeout(() => {
      chordTimer = null;
    }, CHORD_WINDOW_MS);
  }

  function endChord() {
    if (chordTimer) clearTimeout(chordTimer);
    chordTimer = null;
  }

  function onKeyDown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Escape") {
      endChord();
      handlers.onCancel?.();
      return;
    }

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
      handlers.onFiles?.();
      return;
    }

    if (!event.shiftKey && event.code === "KeyO") {
      event.preventDefault();
      endChord();
      handlers.onFiles?.();
      return;
    }

    if (event.shiftKey && event.code === "KeyO") {
      event.preventDefault();
      endChord();
      handlers.onOutline?.();
      return;
    }

    if (event.shiftKey && event.code === "KeyK") {
      event.preventDefault();
      endChord();
      handlers.onAction?.();
      return;
    }
  }

  // Initial HTML controls share the keyboard controller, so clicks queue before
  // React and use its adopted handlers while the native article is retained.
  function onClick(event: MouseEvent) {
    if (!(event.target instanceof Element) || !event.target.closest("[data-reader-file-palette]")) return;
    event.preventDefault();
    endChord();
    handlers.onFiles?.();
  }

  document.addEventListener("keydown", onKeyDown, { capture: true });
  document.addEventListener("click", onClick);
  return {
    setHandlers(next) { handlers = next; },
    dispose() {
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("click", onClick);
      endChord();
    },
  };
}

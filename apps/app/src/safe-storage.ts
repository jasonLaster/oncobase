// Browsers can block Web Storage entirely (privacy settings, sandboxed
// iframes, some private modes). Even reading `window.localStorage` throws a
// SecurityError there, so every render- and boot-path access must be guarded:
// one unguarded read crashes the reader into the root recovery card.

type SafeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolve(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A localStorage facade whose methods never throw. Reads fall back to `null`. */
export const safeLocalStorage: SafeStorage = {
  getItem(key) {
    try {
      return resolve()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      resolve()?.setItem(key, value);
    } catch {
      // Quota exceeded or storage blocked; the value is a convenience only.
    }
  },
  removeItem(key) {
    try {
      resolve()?.removeItem(key);
    } catch {
      // Storage blocked; nothing persisted to remove.
    }
  },
};


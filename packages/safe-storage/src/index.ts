// Browsers can block Web Storage entirely (privacy settings, blocked site data,
// sandboxed iframes, some private modes). Even reading `window.localStorage`
// throws a SecurityError there, and a full quota makes `setItem` throw, so every
// render- and boot-path access must be guarded: one unguarded read crashes the
// reader into the root recovery card. This module is the only place allowed to
// touch Web Storage directly (ESLint enforces it).

export type StorageKind = "localStorage" | "sessionStorage";

export type SafeStorage = {
  /** The stored value, or `null` when missing or when storage is unavailable. */
  getItem(key: string): string | null;
  /** Never throws. Returns `true` only when the value reached real storage. */
  setItem(key: string, value: string): boolean;
  /** Never throws. */
  removeItem(key: string): void;
  /** Stored keys, or `[]` when storage is unavailable. */
  keys(): string[];
};

export type SafeStorageOptions = {
  /**
   * Keep values in memory for the page's lifetime when they cannot be
   * persisted, so a preference that is re-read from storage still takes effect
   * (for example the theme). Leave it off where a later read must reflect
   * durable state, such as a reload-once guard.
   */
  memoryFallback?: boolean;
};

type Backing = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** The browser's storage object, or `null` when there is none or reading it throws. */
export function resolveWebStorage(kind: StorageKind): Backing | null {
  try {
    if (typeof window === "undefined") return null;
    return window[kind] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether `window[kind]` exists and can be read without throwing. For handing
 * storage to third-party code that touches it raw (LiveStore's persisted
 * adapter does): pick a storage-free path when this is false.
 */
export function isWebStorageAvailable(kind: StorageKind): boolean {
  try {
    const storage = resolveWebStorage(kind);
    if (!storage) return false;
    storage.getItem("oncobase:storage-probe");
    return true;
  } catch {
    return false;
  }
}

/** Builds a facade over `resolve()`; exported for tests and unusual hosts. */
export function createSafeStorage(
  resolve: () => Backing | null | undefined,
  { memoryFallback = false }: SafeStorageOptions = {},
): SafeStorage {
  // `null` records a removal that could not reach real storage.
  const memory = new Map<string, string | null>();

  const backing = () => {
    try {
      return resolve() ?? null;
    } catch {
      return null;
    }
  };

  return {
    getItem(key) {
      if (memoryFallback && memory.has(key)) return memory.get(key) ?? null;
      try {
        return backing()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        const storage = backing();
        if (storage) {
          storage.setItem(key, value);
          memory.delete(key);
          return true;
        }
      } catch {
        // Quota exceeded or storage blocked; fall through.
      }
      if (memoryFallback) memory.set(key, value);
      return false;
    },
    removeItem(key) {
      try {
        const storage = backing();
        if (storage) {
          storage.removeItem(key);
          memory.delete(key);
          return;
        }
      } catch {
        // Storage blocked; fall through.
      }
      if (memoryFallback) memory.set(key, null);
    },
    keys() {
      const keys = new Set<string>();
      try {
        const storage = backing();
        for (let index = 0; storage && index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key !== null) keys.add(key);
        }
      } catch {
        // Storage blocked; report only what memory holds.
      }
      for (const [key, value] of memory) {
        if (value === null) keys.delete(key);
        else keys.add(key);
      }
      return [...keys];
    },
  };
}

/** `window.localStorage`, but every method is safe. Writes that fail are dropped. */
export const safeLocalStorage: SafeStorage = createSafeStorage(() => resolveWebStorage("localStorage"));

/** `window.sessionStorage`, but every method is safe. Writes that fail are dropped. */
export const safeSessionStorage: SafeStorage = createSafeStorage(() => resolveWebStorage("sessionStorage"));

/**
 * `safeLocalStorage` that remembers unpersisted writes for the page's lifetime.
 * For UI preferences that are re-read from storage on every render.
 */
export const memoryBackedLocalStorage: SafeStorage = createSafeStorage(
  () => resolveWebStorage("localStorage"),
  { memoryFallback: true },
);

import { useSyncExternalStore } from "react";

const TREE_EXPANSION_KEY = "wiki-vite-expanded-directories";
const serverSnapshot = new Map<string, boolean>([["wiki", true]]);
const listeners = new Set<() => void>();
let snapshot: Map<string, boolean> | undefined;

function readExpandedDirectories() {
  // Stored entries are overrides: absent entries still get the current defaults.
  const expanded = new Map<string, boolean>([["wiki", true]]);
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TREE_EXPANSION_KEY) ?? "null");
    if (Array.isArray(parsed)) {
      // Older readers stored only the explicitly expanded directories.
      for (const slug of parsed) {
        if (typeof slug === "string") expanded.set(slug, true);
      }
    } else if (parsed && typeof parsed === "object") {
      for (const [slug, open] of Object.entries(parsed)) {
        if (typeof open === "boolean") expanded.set(slug, open);
      }
    }
  } catch {
    // Invalid or unavailable storage should not change the default tree.
  }
  return expanded;
}

function getSnapshot() {
  if (!snapshot) {
    snapshot = readExpandedDirectories();
    // Preserve a native HTML folder selection during the React handoff.
    const branch = new URLSearchParams(window.location.search).get("tree");
    if (branch) {
      const parts = branch.split("/");
      for (let index = 1; index <= parts.length; index++) {
        snapshot.set(parts.slice(0, index).join("/"), true);
      }
    }
  }
  return snapshot;
}

function emit() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== TREE_EXPANSION_KEY) return;
  snapshot = readExpandedDirectories();
  emit();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function toggleDirectory(slug: string, nextOpen: boolean) {
  const next = new Map(getSnapshot());
  next.set(slug, nextOpen);
  snapshot = next;
  try {
    localStorage.setItem(TREE_EXPANSION_KEY, JSON.stringify(Object.fromEntries(next)));
  } catch {
    // Keep working in memory when preferences cannot be saved.
  }
  emit();
}

export function useExpandedDirectories() {
  // Both navigation surfaces subscribe to the same choices, including when
  // one is hidden by the responsive layout.
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

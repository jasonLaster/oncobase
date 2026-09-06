import { useEffect, useRef, useSyncExternalStore } from "react";

let intendedSlug: string | null = null;
let intentTimeout: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return intendedSlug;
}

function clearNavigationIntent() {
  if (!intendedSlug) return;
  intendedSlug = null;
  if (intentTimeout) {
    clearTimeout(intentTimeout);
    intentTimeout = null;
  }
  emit();
}

export function setNavigationIntentForSlug(slug: string) {
  intendedSlug = slug;
  if (intentTimeout) clearTimeout(intentTimeout);
  intentTimeout = setTimeout(() => {
    clearNavigationIntent();
  }, 10_000);
  emit();
}

export function useNavigationSlug(currentSlug: string) {
  const intent = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const previousSlugRef = useRef(currentSlug);

  useEffect(() => {
    const previousSlug = previousSlugRef.current;
    previousSlugRef.current = currentSlug;

    if (!intent) return;
    if (currentSlug !== previousSlug || currentSlug === intent) {
      clearNavigationIntent();
    }
  }, [currentSlug, intent]);

  return intent ?? currentSlug;
}

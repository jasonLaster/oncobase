// Where each history entry was scrolled, so Back and Forward return to the
// reader's place. In memory only: a reload starts at the top, as it always has.
const positions = new Map<string, number>();
const MAX_ENTRIES = 200;
// Entries being returned to. While the destination renders it can be briefly
// short, the browser clamps the scroll to 0, and that is not where the reader was.
const restoring = new Set<string>();

export function rememberScrollPosition(key: string, top: number) {
  if (restoring.has(key)) return;
  // Re-insert so the map stays ordered by recency, then drop the oldest.
  positions.delete(key);
  positions.set(key, top);
  if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value!);
}

export function savedScrollPosition(key: string) {
  return positions.get(key);
}

/** Keep an entry's saved position until it has been restored; returns the release. */
export function freezeScrollPosition(key: string) {
  if (!positions.has(key)) return () => {};
  restoring.add(key);
  return () => { restoring.delete(key); };
}

// The history entry on screen, and the element that scrolls. Set by RouteFocus.
let current: { key: string; scroller: () => HTMLElement | null } | null = null;

export function setScrollEntry(key: string, scroller: () => HTMLElement | null) {
  current = { key, scroller };
}

/**
 * Record the entry being left at the moment Back or Forward is pressed. Scroll
 * events arrive a frame late, and the router re-renders synchronously inside its
 * own popstate listener, so anything registered later sees the destination already
 * on screen. Installed when the entry module loads, before the router mounts, so
 * it runs first.
 */
export function installScrollMemory(target: Window = window) {
  target.addEventListener("popstate", () => {
    const scroller = current?.scroller();
    if (current && scroller) rememberScrollPosition(current.key, scroller.scrollTop);
  }, true);
}

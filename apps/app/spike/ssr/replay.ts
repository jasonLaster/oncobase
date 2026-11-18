// SPIKE (P3): pre-hydration input capture and replay. Serialized into the
// document head by source (like bootstrap/reader-shortcuts.ts), so it must be
// self-contained.
//
// Why our own: React 19.2.6 does not replay a discrete event that lands on a
// boundary it cannot hydrate synchronously. dispatchEvent tries a SyncLane
// hydration of the blocking boundary and otherwise calls
// nativeEvent.stopPropagation() (react-dom-client: dispatchEvent,
// discreteReplayableEvents). Before hydrateRoot there is no React listener at
// all. So from first paint until the target's own node is hydrated, this
// script owns the event:
// - capture phase on document (before React's root listeners), so React never
//   sees, drops or double-handles it;
// - only for interactive controls (buttons, role=button/treeitem/tab/menuitem,
//   summary, [data-reader-action]); links navigate natively, form fields type
//   natively, modifier chords stay with the shortcut script;
// - a pressed affordance (data-ssr-pending) at once;
// - replay into the same node as soon as React has hydrated it (React sets
//   __reactProps$* on a host node when it hydrates it), asking React to
//   hydrate that target first (root.unstable_scheduleHydration).
export function installSsrReplay() {
  if ((window as any).__ssrReplay) return;
  const PENDING = "data-ssr-pending";
  type Item = { type: "click" | "keydown"; el: Element; at: number; init: any; replayedAt?: number; dropped?: string };
  const queue: Item[] = [];
  const log: Item[] = [];
  let root: { unstable_scheduleHydration?: (target: Element) => void } | null = null;
  let replaying = false;
  const live = (el: Element) => {
    return Object.keys(el).some(key => key.startsWith("__reactProps$"));
  };
  const control = (target: EventTarget | null) => {
    const el = target instanceof Element ? target : null;
    if (!el || !el.closest("#root")) return null;
    // A link (not inside a control) keeps native navigation; fields keep native typing.
    if (el.closest("input, textarea, select, [contenteditable='true']")) return null;
    const hit = el.closest("button, [role='button'], [role='treeitem'], [role='tab'], [role='menuitem'], summary, [data-reader-action]");
    if (!hit) return null;
    return hit;
  };
  const style = document.createElement("style");
  style.textContent = `[${PENDING}]{cursor:progress!important;opacity:.55;transition:opacity 0s}`;
  document.head.appendChild(style);
  const flush = () => {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i]!;
      if (!item.el.isConnected) { item.dropped = "detached"; queue.splice(i--, 1); continue; }
      if (!live(item.el)) continue;
      queue.splice(i--, 1);
      // Only the first replay of an element clears its affordance.
      if (!queue.some(other => other.el === item.el)) item.el.removeAttribute(PENDING);
      replaying = true;
      try {
        item.el.dispatchEvent(item.type === "click" ? new MouseEvent("click", item.init) : new KeyboardEvent("keydown", item.init));
      } finally { replaying = false; }
      item.replayedAt = performance.now();
    }
    if (queue.length) requestAnimationFrame(flush);
  };
  const take = (event: Event) => {
    if (replaying || !event.isTrusted) return;
    const el = control(event.target);
    if (!el || live(el)) return;
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (key.metaKey || key.ctrlKey || key.altKey || key.key === "Tab") return;
      // Enter/Space on a native button become a click; let the browser make it.
      if ((key.key === "Enter" || key.key === " ") && el.tagName === "BUTTON") return;
    }
    event.stopImmediatePropagation();
    if (event.type === "click") event.preventDefault();
    const e = event as MouseEvent & KeyboardEvent;
    const init = event.type === "click"
      ? { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY, button: e.button, detail: e.detail,
          ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }
      : { bubbles: true, cancelable: true, composed: true, key: e.key, code: e.code, shiftKey: e.shiftKey };
    const item: Item = { type: event.type as Item["type"], el, at: event.timeStamp, init };
    queue.push(item);
    log.push(item);
    el.setAttribute(PENDING, "");
    try { root?.unstable_scheduleHydration?.(el); } catch { /* hydration still proceeds in order */ }
    requestAnimationFrame(flush);
  };
  document.addEventListener("click", take, true);
  document.addEventListener("keydown", take, true);
  (window as any).__ssrReplay = {
    log,
    /** Called with the hydration root right after hydrateRoot. */
    attach(next: typeof root) {
      root = next;
      for (const item of queue) try { root?.unstable_scheduleHydration?.(item.el); } catch { /* optional */ }
      requestAnimationFrame(flush);
    },
    flush,
  };
}

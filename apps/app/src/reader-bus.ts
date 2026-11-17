import type { PaletteMode } from "./shell/CommandPalette";

/**
 * In-app signals between reader components, typed by name. It replaces
 * window CustomEvents for messages whose sender and receiver both live in
 * this app. Events that cross a boundary stay on `window`:
 * - "wiki-vite:refresh-manifest": dispatched by e2e tests (`sync/events.ts`);
 * - "wiki-auth-session-change": also heard by `@oncobase/wiki-comments`;
 * - "wiki-shell-open-auth-dialog", "comments-pane-state-change": declared in
 *   `@oncobase/wiki-shell` / `@oncobase/wiki-comments`;
 * - "mobile-comments-panel-open": heard by `@oncobase/wiki-comments`;
 * - "chat:new", "chat:route-replaced": shared with `@oncobase/chat`.
 *
 * Delivery matches `window.dispatchEvent`: synchronous, in subscription
 * order, a handler added twice runs once, and a throwing handler is reported
 * without stopping the others.
 */
export type ReaderEvents = {
  /** Fetch the current route's body again (sync controller). */
  "retry-page": undefined;
  /** Check the manifest now, as a user request (sync controller). */
  "refresh-manifest": undefined;
  /** Start background cache warming (background prefetch). */
  "warm-cache": undefined;
  /** A foreground request started; background prefetch yields. */
  "foreground-fetch": undefined;
  /** Open the command palette in a mode (header palette host). */
  "open-command-palette": PaletteMode;
  /** WebMCP private-page consent changed; re-register tools. */
  "agent-access-change": undefined;
};

type Handler<K extends keyof ReaderEvents> = (payload: ReaderEvents[K]) => void;

const handlers = new Map<keyof ReaderEvents, Set<Handler<never>>>();

export function on<K extends keyof ReaderEvents>(name: K, handler: Handler<K>): () => void {
  let set = handlers.get(name);
  if (!set) handlers.set(name, set = new Set());
  set.add(handler);
  return () => { set.delete(handler); };
}

export function emit<K extends keyof ReaderEvents>(
  name: K,
  ...[payload]: ReaderEvents[K] extends undefined ? [] : [ReaderEvents[K]]
) {
  const set = handlers.get(name);
  if (!set) return;
  // Like dispatchEvent: a handler removed during delivery does not run, and
  // one added during delivery waits for the next emit.
  for (const handler of [...set]) {
    if (!set.has(handler)) continue;
    try { (handler as Handler<K>)(payload as ReaderEvents[K]); } catch (error) { reportError(error); }
  }
}

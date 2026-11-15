import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router";
import { freezeScrollPosition, rememberScrollPosition, savedScrollPosition, setScrollEntry } from "./scroll-memory";

export const MAIN_CONTENT_ID = "main-content";
/** A destination that is still loading: the previous article stays up, or a skeleton shows. */
const PENDING_SELECTOR = "[data-route-pending], .page-shell-loading, .wiki-shell-page-loading";
const EDITABLE_SELECTOR = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Focus an element that is not normally focusable, for as long as it has focus.
 * A permanent tabindex on the page would make every click in the article focus
 * it, and Chrome then stops showing focus for later scripted focus (tooltips
 * that open on keyboard focus stop opening).
 */
export function focusTransiently(element: HTMLElement) {
  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
    element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
  }
  element.focus({ preventScroll: true });
}

/** First stop in the tab order. Without it, a keyboard reader tabs through the whole file tree to reach the page. */
export function SkipLink() {
  return (
    <a
      className="skip-link"
      href={`#${MAIN_CONTENT_ID}`}
      data-test-id="skip-link"
      onClick={(event) => {
        // Focus directly: a hash change would run the router and the page's anchor handling.
        event.preventDefault();
        const main = document.getElementById(MAIN_CONTENT_ID);
        if (main) focusTransiently(main);
      }}
    >
      Skip to content
    </a>
  );
}

/**
 * Put the page back where the reader left it and keep it there while the
 * article finishes laying out. Long pages grow after their first render (tables
 * are enhanced, images load), and the browser's scroll anchoring then follows
 * whatever happened to be on screen, not the reader's place. Stops as soon as
 * the reader scrolls, taps or types, or the layout has been still for a second.
 */
function holdScrollPosition(main: HTMLElement, top: number, onStop: () => void) {
  const intent = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  let quiet = 0;
  // Settled once the layout has been still for a second; a slow page can take longer than that to arrive.
  const apply = () => {
    if (Math.abs(main.scrollTop - top) > 1) main.scrollTo({ top, behavior: "instant" });
    window.clearTimeout(quiet);
    quiet = window.setTimeout(stop, 1000);
  };
  const observer = new ResizeObserver(apply);
  // A route can replace the page element itself; watch whatever is there now.
  const children = new MutationObserver(() => { for (const child of main.children) observer.observe(child); });
  const stop = () => {
    onStop();
    observer.disconnect();
    children.disconnect();
    window.clearTimeout(quiet);
    window.clearTimeout(limit);
    for (const type of intent) window.removeEventListener(type, stop, true);
  };
  const limit = window.setTimeout(stop, 10_000);
  for (const type of intent) window.addEventListener(type, stop, { capture: true, passive: true });
  for (const child of main.children) observer.observe(child);
  children.observe(main, { childList: true });
  apply();
  return stop;
}

/** The title as read aloud: without the "#" link the markdown renderer appends to headings, or decorative marks. */
function headingText(heading: HTMLElement) {
  const copy = heading.cloneNode(true) as HTMLElement;
  for (const extra of copy.querySelectorAll(".heading-anchor, [aria-hidden='true']")) extra.remove();
  return copy.textContent?.replace(/\s+/g, " ").trim();
}

/** Routes with their own navigation inside the page: moving focus between them would interrupt typing or tab use. */
function sectionOf(pathname: string) {
  return ["/chat", "/admin"].find(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)) ?? null;
}

/**
 * What a full page load gives for free and a client-side route change does not:
 * focus moves to the new page, the new page is announced, and Back returns to
 * where the reader was. Renders the announcement region.
 */
export function RouteFocus() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [message, setMessage] = useState("");
  const previousPathname = useRef(location.pathname);
  const releaseFrozen = useRef<(() => void) | undefined>(undefined);

  // A layout effect, so the listener already belongs to the new history entry
  // when the destination page scrolls itself to the top in the same commit.
  useLayoutEffect(() => {
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;
    // Back/Forward: the saved place stands until it is restored (see finish below).
    const release = navigationType === "POP" && !location.hash ? freezeScrollPosition(location.key) : undefined;
    releaseFrozen.current = release;
    const onScroll = () => rememberScrollPosition(location.key, main.scrollTop);
    main.addEventListener("scroll", onScroll, { passive: true });
    // Back/Forward right after a scroll is recorded by the listener installScrollMemory added at startup.
    setScrollEntry(location.key, () => document.getElementById(MAIN_CONTENT_ID));
    return () => { main.removeEventListener("scroll", onScroll); release?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  useEffect(() => {
    const from = previousPathname.current;
    // Same page (a query change): nothing loads, so there is nothing to wait for before recording scroll.
    if (from === location.pathname) { releaseFrozen.current?.(); return; }
    previousPathname.current = location.pathname;
    const main = document.getElementById(MAIN_CONTENT_ID);
    if (!main) return;
    const withinSection = sectionOf(from) !== null && sectionOf(from) === sectionOf(location.pathname);
    const history = navigationType === "POP";
    let finished = false;
    let releaseScroll: (() => void) | undefined;

    const finish = (heading: HTMLElement | null) => {
      finished = true;
      const title = (heading && headingText(heading)) || document.title.split(" — ")[0]?.trim();
      if (title) setMessage(`Loaded ${title}`);
      if (history && !location.hash) {
        const saved = savedScrollPosition(location.key);
        const unfreeze = releaseFrozen.current;
        if (saved !== undefined) {
          const stopHolding = holdScrollPosition(main, saved, () => unfreeze?.());
          releaseScroll = stopHolding;
        } else unfreeze?.();
      }
      if (withinSection) return;
      const active = document.activeElement instanceof HTMLElement && document.activeElement.isConnected && document.activeElement !== document.body
        ? document.activeElement : null;
      // Never take focus from someone typing, and on Back/Forward leave it where the reader put it.
      if (active?.matches(EDITABLE_SELECTOR) || (history && active)) return;
      focusTransiently(history ? main : heading ?? main);
    };
    const settle = () => {
      if (finished) return true;
      if (main.querySelector(PENDING_SELECTOR)) return false;
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      finish(heading);
      return true;
    };

    if (settle()) return () => releaseScroll?.();
    const observer = new MutationObserver(() => { if (settle()) observer.disconnect(); });
    observer.observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-route-pending", "class"] });
    // A page without a heading still gets focus and an announcement, from its document title.
    const untitled = window.setTimeout(() => { if (!finished && !main.querySelector(PENDING_SELECTOR)) { observer.disconnect(); finish(null); } }, 1500);
    const giveUp = window.setTimeout(() => { observer.disconnect(); releaseFrozen.current?.(); }, 20_000);
    return () => { observer.disconnect(); window.clearTimeout(untitled); window.clearTimeout(giveUp); releaseScroll?.(); };
    // One run per destination: the navigation type and history key belong to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <p className="wiki-shell-sr-only" role="status" aria-live="polite" aria-atomic="true" data-test-id="route-announcer">
      {message}
    </p>
  );
}

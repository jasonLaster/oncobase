"use client";

import { useEffect, useRef } from "react";

const ROUTED_ANCHOR_SCROLL_KEY = "diana:routed-anchor-scroll";

export type WikiMarkdownRouteAdapter = {
  push: (href: string, options?: { scroll?: boolean }) => void;
};

export type WikiMarkdownNotificationAdapter = {
  success: (message: string) => void;
  error: (message: string) => void;
};

function getScrollContainer(element: HTMLElement | null) {
  if (!element) return null;

  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

function scrollElementIntoContainerView(
  target: HTMLElement,
  behavior: ScrollBehavior = "auto",
) {
  const scrollContainer = getScrollContainer(target);
  if (!scrollContainer) return;

  const targetRect = target.getBoundingClientRect();

  if (
    scrollContainer === document.documentElement ||
    scrollContainer === document.body ||
    scrollContainer === document.scrollingElement
  ) {
    window.scrollTo({
      top: Math.max(0, window.scrollY + targetRect.top),
      behavior,
    });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const nextTop = scrollContainer.scrollTop + targetRect.top - containerRect.top;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior });
}

function scrollContainerToTop(element: HTMLElement) {
  const scrollContainer = getScrollContainer(element);
  if (!scrollContainer) return;

  if (
    scrollContainer === document.documentElement ||
    scrollContainer === document.body ||
    scrollContainer === document.scrollingElement
  ) {
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  scrollContainer.scrollTo({ top: 0, behavior: "auto" });
}

function getElementForHash(root: HTMLElement, hash: string) {
  if (!hash || hash === "#") return null;

  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // Malformed hashes should not break page hydration.
  }

  return root.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? document.getElementById(id);
}

function scrollToHash(
  root: HTMLElement,
  hash: string,
  behavior: ScrollBehavior = "auto",
) {
  const target = getElementForHash(root, hash);
  if (!target) return false;
  scrollElementIntoContainerView(target, behavior);
  return true;
}

function isPlainLeftClick(event: MouseEvent) {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function isSkippableAnchor(anchor: HTMLAnchorElement) {
  const target = anchor.getAttribute("target");
  return (
    anchor.hasAttribute("download") ||
    (target !== null && target.toLowerCase() !== "_self")
  );
}

function isAppRouteUrl(url: URL) {
  if (url.origin !== window.location.origin) return false;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_next/")) {
    return false;
  }

  const lastSegment = url.pathname.split("/").pop() ?? "";
  const extension = lastSegment.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  return !extension || extension === "md";
}

function toAppHref(url: URL) {
  const pathname = url.pathname.replace(/\.md$/i, "");
  return `${pathname}${url.search}${url.hash}`;
}

function markPendingRoutedAnchorScroll(mode: "hash" | "top") {
  try {
    window.sessionStorage.setItem(ROUTED_ANCHOR_SCROLL_KEY, mode);
  } catch {
    // Storage can be unavailable in private contexts; navigation should still work.
  }
}

function consumePendingRoutedAnchorScroll() {
  try {
    const value = window.sessionStorage.getItem(ROUTED_ANCHOR_SCROLL_KEY);
    window.sessionStorage.removeItem(ROUTED_ANCHOR_SCROLL_KEY);
    return value;
  } catch {
    return null;
  }
}

function updateAddressBar(url: URL) {
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand("copy");
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  } finally {
    textarea.remove();
  }
}

function copyHeadingAnchorUrl(
  url: URL,
  notification?: WikiMarkdownNotificationAdapter,
) {
  copyText(url.toString())
    .then(() => {
      notification?.success("Link copied");
    })
    .catch(() => {
      notification?.error("Unable to copy link");
    });
}

function defaultRouteAdapterPush(href: string) {
  window.location.assign(href);
}

function handleRoutedAnchorClick(
  event: MouseEvent,
  root: HTMLElement,
  routeAdapter?: WikiMarkdownRouteAdapter,
  notification?: WikiMarkdownNotificationAdapter,
) {
  if (event.defaultPrevented || !isPlainLeftClick(event)) return;

  const target = event.target;
  if (!(target instanceof Element)) return;

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !root.contains(anchor) || isSkippableAnchor(anchor)) return;

  const rawHref = anchor.getAttribute("href");
  if (!rawHref || rawHref.startsWith("#:~:text=")) return;

  let url: URL;
  try {
    url = new URL(rawHref, window.location.href);
  } catch {
    return;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (!isAppRouteUrl(url)) return;

  event.preventDefault();

  const shouldCopyHeadingLink = anchor.classList.contains("heading-anchor");
  const current = new URL(window.location.href);
  const samePage = url.pathname === current.pathname && url.search === current.search;

  if (samePage) {
    if (url.hash) {
      const nextHref = `${url.pathname}${url.search}${url.hash}`;
      const currentHref = `${current.pathname}${current.search}${current.hash}`;
      if (nextHref !== currentHref) {
        updateAddressBar(url);
      }
      if (shouldCopyHeadingLink) {
        copyHeadingAnchorUrl(url, notification);
      }
      scrollToHash(root, url.hash, "smooth");
      return;
    }

    updateAddressBar(url);
    scrollContainerToTop(root);
    return;
  }

  markPendingRoutedAnchorScroll(url.hash ? "hash" : "top");
  const href = toAppHref(url);
  if (routeAdapter) {
    routeAdapter.push(href, { scroll: !url.hash });
  } else {
    defaultRouteAdapterPush(href);
  }
}

export function RoutedAnchorLinks({
  scopeKey,
  routeAdapter,
  notification,
}: {
  scopeKey?: string;
  routeAdapter?: WikiMarkdownRouteAdapter;
  notification?: WikiMarkdownNotificationAdapter;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = sentinelRef.current?.parentElement;
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      handleRoutedAnchorClick(event, root, routeAdapter, notification);
    };

    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("click", onClick);
    };
  }, [notification, routeAdapter, scopeKey]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

export function MarkdownHeadingAnchors({
  disableAnchors,
  scopeKey,
  routeAdapter,
  notification,
}: {
  disableAnchors?: boolean;
  scopeKey?: string;
  routeAdapter?: WikiMarkdownRouteAdapter;
  notification?: WikiMarkdownNotificationAdapter;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prose = sentinelRef.current?.parentElement;
    if (!prose) {
      return;
    }

    const onRoutedAnchorClick = (event: MouseEvent) => {
      handleRoutedAnchorClick(event, prose, routeAdapter, notification);
    };

    prose.addEventListener("click", onRoutedAnchorClick);

    if (disableAnchors) {
      return () => {
        prose.removeEventListener("click", onRoutedAnchorClick);
      };
    }

    const pendingScroll = consumePendingRoutedAnchorScroll();

    if (window.location.hash) {
      requestAnimationFrame(() => {
        scrollToHash(prose, window.location.hash);
        window.setTimeout(() => scrollToHash(prose, window.location.hash), 100);
      });
    } else if (pendingScroll === "top") {
      requestAnimationFrame(() => {
        scrollContainerToTop(prose);
      });
    }

    const onHashChange = () => scrollToHash(prose, window.location.hash, "smooth");
    window.addEventListener("hashchange", onHashChange);

    const headingCleanupFns: Array<() => void> = [];
    const wiredHeadings = new WeakSet<HTMLElement>();
    const supportsHover = window.matchMedia("(hover: hover)").matches;

    const syncHeadings = () => {
      const headings = prose.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");

      headings.forEach((heading) => {
        if (wiredHeadings.has(heading)) {
          return;
        }

        const id = heading.id;
        if (!id) {
          return;
        }

        wiredHeadings.add(heading);
        heading.classList.add("wiki-heading-linked", "cursor-pointer");

        const onClick = (event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("a,button,input,select,textarea,[role='button']")) {
            return;
          }

          const nextHash = `#${id}`;
          if (window.location.hash === nextHash) {
            scrollElementIntoContainerView(heading, "smooth");
            return;
          }

          window.location.hash = id;
        };

        heading.addEventListener("click", onClick);
        headingCleanupFns.push(() => heading.removeEventListener("click", onClick));

        if (!supportsHover || heading.querySelector(".heading-anchor")) {
          return;
        }

        heading.classList.add("wiki-heading-group", "group", "relative");

        const anchor = document.createElement("a");
        anchor.href = `#${id}`;
        anchor.className =
          "heading-anchor opacity-0 group-hover:opacity-100 text-[var(--text-muted)] no-underline hover:no-underline hover:text-[var(--brand)] transition-opacity cursor-pointer";
        anchor.setAttribute("aria-label", `Link to \"${heading.textContent}\"`);
        anchor.textContent = "#";

        heading.appendChild(anchor);
      });
    };

    syncHeadings();
    const observer = new MutationObserver(syncHeadings);
    observer.observe(prose, { childList: true, subtree: true });

    return () => {
      prose.removeEventListener("click", onRoutedAnchorClick);
      window.removeEventListener("hashchange", onHashChange);
      observer.disconnect();
      headingCleanupFns.forEach((cleanup) => cleanup());
    };
  }, [disableAnchors, notification, routeAdapter, scopeKey]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

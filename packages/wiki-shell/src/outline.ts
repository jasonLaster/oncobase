"use client";

import { type RefObject, useEffect, useMemo, useState } from "react";

export type OutlineItem = {
  id: string;
  text: string;
  level: number;
};

export type UseDocumentOutlineOptions = {
  contentKey: string;
  rootRef: RefObject<HTMLElement | null>;
  scrollRootSelector?: string;
};

const DEFAULT_HEADING_SELECTOR = "h1[id], h2[id], h3[id], h4[id]";

export function getOutlineHeadingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(
      'a[href^="#"], a[aria-hidden="true"], .anchor, .header-anchor, .hash-link, .heading-anchor',
    )
    .forEach((anchor) => {
      anchor.remove();
    });

  const text = clone.textContent ?? heading.textContent ?? "";
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/(?:\s*#\s*)+$/, "")
    .trim();
}

export function collectOutline(
  root: ParentNode = document,
  selector = DEFAULT_HEADING_SELECTOR,
): OutlineItem[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
    .map((heading) => ({
      id: heading.id,
      text: getOutlineHeadingText(heading) || heading.id,
      level: Number.parseInt(heading.tagName.replace("H", ""), 10),
    }))
    .filter((item) => item.id && item.text && Number.isFinite(item.level));
}

function getScrollContainer(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") return null;

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

export function scrollElementIntoContainerView(target: HTMLElement, offset = 24) {
  const scrollContainer = getScrollContainer(target);
  if (!scrollContainer) return;

  const targetRect = target.getBoundingClientRect();

  if (
    scrollContainer === document.documentElement ||
    scrollContainer === document.body ||
    scrollContainer === document.scrollingElement
  ) {
    const nextTop = window.scrollY + targetRect.top - offset;
    window.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const nextTop =
    scrollContainer.scrollTop + targetRect.top - containerRect.top - offset;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

export function scrollToOutlineItem(
  item: OutlineItem,
  pathname = window.location.pathname,
  root: ParentNode = document,
) {
  const target =
    root instanceof Document
      ? root.getElementById(item.id)
      : root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);

  window.history.replaceState(null, "", `${pathname}#${item.id}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
}

export function useDocumentOutline({
  contentKey,
  rootRef,
  scrollRootSelector = ".content-shell",
}: UseDocumentOutlineOptions) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [activeId, setActiveId] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""),
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      setItems([]);
      return;
    }

    const update = () => setItems(collectOutline(root));
    update();

    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [contentKey, rootRef]);

  useEffect(() => {
    const onHashChange = () => setActiveId(window.location.hash.replace(/^#/, ""));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || items.length === 0) return;

    const headings = items
      .map((item) => root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`))
      .filter((heading): heading is HTMLElement => Boolean(heading));
    if (headings.length === 0) return;

    const scrollRoot = document.querySelector(scrollRootSelector);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        const next = visible[0]?.target.id;
        if (next) setActiveId(next);
      },
      {
        root: scrollRoot instanceof Element ? scrollRoot : null,
        rootMargin: "-15% 0px -70% 0px",
        threshold: [0, 1],
      },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [items, rootRef, scrollRootSelector]);

  return useMemo(() => ({ activeId, items }), [activeId, items]);
}
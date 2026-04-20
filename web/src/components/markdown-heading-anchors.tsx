"use client";

import { useEffect, useRef } from "react";

function getScrollContainer(element: HTMLElement | null) {
  if (!element) return null;

  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

function scrollElementIntoContainerView(target: HTMLElement, behavior: ScrollBehavior = "auto") {
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

export function MarkdownHeadingAnchors({
  disableAnchors,
}: {
  disableAnchors?: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disableAnchors) {
      return;
    }

    const prose = sentinelRef.current?.parentElement;
    if (!prose) {
      return;
    }

    const scrollToHash = (behavior: ScrollBehavior = "auto") => {
      const target = getElementForHash(prose, window.location.hash);
      if (!target) return;
      scrollElementIntoContainerView(target, behavior);
    };

    if (window.location.hash) {
      requestAnimationFrame(() => {
        scrollToHash();
        window.setTimeout(scrollToHash, 100);
      });
    }

    const onHashChange = () => scrollToHash("smooth");
    window.addEventListener("hashchange", onHashChange);

    const headingCleanupFns: Array<() => void> = [];
    const supportsHover = window.matchMedia("(hover: hover)").matches;
    const headings = prose.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");

    headings.forEach((heading) => {
      const id = heading.id;
      if (!id) {
        return;
      }

      heading.classList.add("cursor-pointer");

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

      heading.classList.add("group", "relative");

      const anchor = document.createElement("a");
      anchor.href = `#${id}`;
      anchor.className =
        "heading-anchor opacity-0 group-hover:opacity-100 text-[var(--text-muted)] no-underline hover:no-underline hover:text-[var(--brand)] transition-opacity cursor-pointer";
      anchor.setAttribute("aria-label", `Link to \"${heading.textContent}\"`);
      anchor.textContent = "#";

      heading.appendChild(anchor);
    });

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      headingCleanupFns.forEach((cleanup) => cleanup());
    };
  }, [disableAnchors]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

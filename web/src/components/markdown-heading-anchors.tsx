"use client";

import { useEffect, useRef } from "react";

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
          document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      headingCleanupFns.forEach((cleanup) => cleanup());
    };
  }, [disableAnchors]);

  return <div ref={sentinelRef} style={{ display: "none" }} />;
}

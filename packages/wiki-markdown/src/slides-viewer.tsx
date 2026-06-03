"use client";

import { useEffect, useMemo } from "react";
import { resolveImageSrc } from "./paths";

export type SlidesViewerImage = {
  src: string;
  alt?: string;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function setActiveSlide(viewer: HTMLElement, nextIndex: number) {
  const slides = Array.from(
    viewer.querySelectorAll<HTMLElement>("[data-wiki-slide]"),
  );
  if (slides.length === 0) return;

  const safeIndex = Number.isFinite(nextIndex) ? nextIndex : 0;
  const boundedIndex = ((safeIndex % slides.length) + slides.length) % slides.length;

  slides.forEach((slide, index) => {
    const active = index === boundedIndex;
    slide.hidden = !active;
    slide.dataset.active = active ? "true" : "false";
  });

  viewer.dataset.index = String(boundedIndex);

  const status = viewer.querySelector<HTMLElement>("[data-wiki-slides-status]");
  if (status) {
    status.textContent = `${boundedIndex + 1} / ${slides.length}`;
  }
}

export function SlidesViewerControls({
  scopeSelector = ".prose",
}: {
  scopeSelector?: string;
}) {
  useEffect(() => {
    const prose = document.querySelector<HTMLElement>(scopeSelector);
    if (!prose) return;

    const viewers = Array.from(
      prose.querySelectorAll<HTMLElement>("[data-wiki-slides]"),
    );
    viewers.forEach((viewer) => setActiveSlide(viewer, Number(viewer.dataset.index ?? "0")));

    const onClick = (event: Event) => {
      const control =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-wiki-slides-prev], [data-wiki-slides-next]")
          : null;
      if (!control) return;

      const viewer = control.closest<HTMLElement>("[data-wiki-slides]");
      if (!viewer) return;

      const current = Number(viewer.dataset.index ?? "0");
      const direction = control.hasAttribute("data-wiki-slides-prev") ? -1 : 1;
      setActiveSlide(viewer, current + direction);
    };

    prose.addEventListener("click", onClick);

    return () => {
      prose.removeEventListener("click", onClick);
    };
  }, [scopeSelector]);

  return null;
}

export function SlidesViewer({
  images,
  currentSlug,
  apiBasePath,
  className,
}: {
  images: SlidesViewerImage[];
  currentSlug?: string;
  apiBasePath?: string;
  className?: string;
}) {
  const slides = useMemo(
    () =>
      images
        .map((image) => ({
          src: resolveImageSrc(image.src, currentSlug, apiBasePath),
          alt: image.alt ?? "",
        }))
        .filter((image) => image.src),
    [apiBasePath, currentSlug, images],
  );

  if (slides.length === 0) return null;

  return (
    <figure
      className={classNames("wiki-slides-viewer", className)}
      data-index="0"
      data-wiki-slides=""
    >
      <div className="wiki-slides-viewer__stage">
        <ol className="wiki-slides-viewer__slides">
          {slides.map((image, index) => (
            <li
              className="wiki-slides-viewer__slide"
              data-active={index === 0 ? "true" : "false"}
              data-wiki-slide=""
              hidden={index !== 0}
              key={`${image.src}:${index}`}
            >
              <img alt={image.alt} src={image.src} />
            </li>
          ))}
        </ol>
      </div>
      <div className="wiki-slides-viewer__controls">
        <button
          className="wiki-slides-viewer__button"
          data-wiki-slides-prev=""
          type="button"
        >
          Previous
        </button>
        <span className="wiki-slides-viewer__status" data-wiki-slides-status="">
          1 / {slides.length}
        </span>
        <button
          className="wiki-slides-viewer__button"
          data-wiki-slides-next=""
          type="button"
        >
          Next
        </button>
      </div>
    </figure>
  );
}

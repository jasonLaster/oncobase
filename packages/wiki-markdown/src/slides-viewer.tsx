"use client";

import { useEffect, useMemo, useState } from "react";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer.tsx";
import { ImageTheaterModal } from "./image-theater-modal.tsx";
import {
  type TheaterImageState,
} from "./image-theater-state.ts";
import { resolveImageSrc } from "./paths.ts";
import { sortSlidesNewestFirst } from "./slides-sort.ts";

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
  ImageComponent = DefaultWikiImage,
}: {
  images: SlidesViewerImage[];
  currentSlug?: string;
  apiBasePath?: string;
  className?: string;
  ImageComponent?: WikiImageComponent;
}) {
  const slides = useMemo(
    () =>
      sortSlidesNewestFirst(images).reduce<Array<{ src: string; alt: string }>>(
        (resolved, image) => {
          const src = resolveImageSrc(image.src, currentSlug, apiBasePath);
          if (src) resolved.push({ src, alt: image.alt ?? "" });
          return resolved;
        },
        [],
      ),
    [apiBasePath, currentSlug, images],
  );
  const [theaterImage, setTheaterImage] = useState<TheaterImageState | null>(null);

  if (slides.length === 0) return null;

  const openSlide = (index: number) => {
    const slide = slides[index];
    if (!slide) return;

    setTheaterImage({
      ...slide,
      images: slides,
      index,
    });
  };

  return (
    <>
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
                <button
                  aria-label={image.alt ? `Open image: ${image.alt}` : "Open image"}
                  className="wiki-slides-viewer__image-button"
                  onClick={() => openSlide(index)}
                  type="button"
                >
                  <ImageComponent
                    alt={image.alt}
                    data-theater-image=""
                    src={image.src}
                  />
                </button>
              </li>
            ))}
          </ol>
        </div>
        <div className="wiki-slides-viewer__controls">
          <button
            aria-label="Previous slide"
            className="wiki-slides-viewer__button"
            data-wiki-slides-prev=""
            title="Previous slide"
            type="button"
          >
            <span aria-hidden="true">&lt;</span>
          </button>
          <span className="wiki-slides-viewer__status" data-wiki-slides-status="">
            1 / {slides.length}
          </span>
          <button
            aria-label="Next slide"
            className="wiki-slides-viewer__button"
            data-wiki-slides-next=""
            title="Next slide"
            type="button"
          >
            <span aria-hidden="true">&gt;</span>
          </button>
        </div>
      </figure>
      {theaterImage ? (
        <ImageTheaterModal
          ImageComponent={ImageComponent}
          image={theaterImage}
          onClose={() => setTheaterImage(null)}
          onImageChange={setTheaterImage}
        />
      ) : null}
    </>
  );
}

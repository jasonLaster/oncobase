"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import type { ComponentProps, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { resolveImageSrc } from "./paths";

export type TheaterImageItem = {
  src: string;
  alt: string;
};

export type TheaterImageState = TheaterImageItem & {
  images?: TheaterImageItem[];
  index?: number;
};

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getDownloadName(src: string) {
  try {
    const url = new URL(src, window.location.href);
    const proxiedPath = url.searchParams.get("path");
    const filePath = proxiedPath ? decodeURIComponent(proxiedPath) : url.pathname;
    return filePath.split("/").filter(Boolean).pop() ?? "image";
  } catch {
    return "image";
  }
}

function isVisibleImage(image: HTMLImageElement) {
  const rect = image.getBoundingClientRect();
  const style = window.getComputedStyle(image);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function imageItemFromElement(
  image: HTMLImageElement,
  { requireVisible = false }: { requireVisible?: boolean } = {},
): TheaterImageItem | null {
  const src = image.currentSrc || image.src;
  if (!src || (requireVisible && !isVisibleImage(image))) return null;

  return {
    src,
    alt: image.alt || "Image preview",
  };
}

function imageStateFromElement(image: HTMLImageElement): TheaterImageState | null {
  const item = imageItemFromElement(image, { requireVisible: true });
  if (!item) return null;

  const viewer = image.closest<HTMLElement>("[data-wiki-slides]");
  if (!viewer) return item;

  const slideImages = Array.from(
    viewer.querySelectorAll<HTMLImageElement>("[data-wiki-slide] img"),
  );
  const images = slideImages
    .map((slideImage) => imageItemFromElement(slideImage))
    .filter((slideImage): slideImage is TheaterImageItem => Boolean(slideImage));
  const index = Math.max(0, slideImages.indexOf(image));

  return images.length > 1 ? { ...item, images, index } : item;
}

export function ImageTheaterModal({
  image,
  onImageChange,
  onClose,
}: {
  image: TheaterImageState;
  onImageChange?: (image: TheaterImageState) => void;
  onClose: () => void;
}) {
  const downloadName = useMemo(() => getDownloadName(image.src), [image.src]);
  const slideImages = Array.isArray(image.images) ? image.images : null;
  const slideIndex = typeof image.index === "number" ? image.index : null;
  const canNavigate = Boolean(slideImages && slideImages.length > 1 && slideIndex !== null);
  const status =
    slideImages && slideIndex !== null && slideImages.length > 1
      ? `${slideIndex + 1} / ${slideImages.length}`
      : null;
  const navigate = useCallback((delta: number) => {
    if (!slideImages || slideImages.length < 2 || slideIndex === null) return;

    const nextIndex =
      ((slideIndex + delta) % slideImages.length + slideImages.length) %
      slideImages.length;
    const nextImage = slideImages[nextIndex];
    if (!nextImage) return;

    onImageChange?.({
      ...nextImage,
      images: slideImages,
      index: nextIndex,
    });
  }, [onImageChange, slideImages, slideIndex]);
  const closeOnMaskClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  const onModalKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") onClose();
    if (event.key === "ArrowLeft") navigate(-1);
    if (event.key === "ArrowRight") navigate(1);
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onModalKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onModalKeyDown);
    };
  }, []);

  return createPortal(
    <div
      aria-label={image.alt}
      aria-modal="true"
      className="wiki-image-theater"
      role="dialog"
    >
      <div className="wiki-image-theater__frame" onClick={closeOnMaskClick}>
        <div className="wiki-image-theater__toolbar">
          {canNavigate ? (
            <div className="wiki-image-theater__nav">
              <button
                aria-label="Previous slide"
                className="wiki-image-theater__button wiki-image-theater__button--icon"
                onClick={() => navigate(-1)}
                title="Previous slide"
                type="button"
              >
                <span aria-hidden="true">&lt;</span>
              </button>
              <span className="wiki-image-theater__status">{status}</span>
              <button
                aria-label="Next slide"
                className="wiki-image-theater__button wiki-image-theater__button--icon"
                onClick={() => navigate(1)}
                title="Next slide"
                type="button"
              >
                <span aria-hidden="true">&gt;</span>
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="wiki-image-theater__actions">
            <a
              className="wiki-image-theater__button"
              download={downloadName}
              href={image.src}
              title="Download image"
            >
              <span aria-hidden="true">Download</span>
              <span className="wiki-sr-only">Download image</span>
            </a>
            <button
              aria-label="Close image preview"
              className="wiki-image-theater__button"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <span aria-hidden="true">Close</span>
            </button>
          </div>
        </div>
        <div className="wiki-image-theater__stage" onClick={closeOnMaskClick}>
          <img
            alt={image.alt}
            className="wiki-image-theater__image"
            src={image.src}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ImageTheater({ scopeSelector = ".prose" }: { scopeSelector?: string }) {
  const [image, setImage] = useState<TheaterImageState | null>(null);

  useEffect(() => {
    const prose = document.querySelector<HTMLElement>(scopeSelector);
    if (!prose) return;

    const openImage = (target: EventTarget | null) => {
      const imageElement =
        target instanceof Element
          ? target.closest<HTMLImageElement>("img[data-theater-image]")
          : null;
      const nextImage = imageElement ? imageStateFromElement(imageElement) : null;
      if (!nextImage) return false;

      setImage(nextImage);
      return true;
    };

    const onClick = (event: Event) => {
      if (openImage(event.target)) {
        event.stopImmediatePropagation();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const imageElement =
        event.target instanceof Element
          ? event.target.closest<HTMLImageElement>("img[data-theater-image]")
          : null;
      if (!imageElement) return;

      event.preventDefault();
      if (openImage(imageElement)) {
        event.stopImmediatePropagation();
      }
    };

    prose.addEventListener("click", onClick);
    prose.addEventListener("keydown", onKeyDown);

    return () => {
      prose.removeEventListener("click", onClick);
      prose.removeEventListener("keydown", onKeyDown);
    };
  }, [scopeSelector]);

  return image ? (
    <ImageTheaterModal
      image={image}
      onClose={() => setImage(null)}
      onImageChange={setImage}
    />
  ) : null;
}

export function TheaterImage({
  className,
  currentSlug,
  apiBasePath,
  src,
  alt = "",
  ...props
}: ComponentProps<"img"> & {
  currentSlug?: string;
  apiBasePath?: string;
}) {
  const resolvedSrc =
    typeof src === "string" ? resolveImageSrc(src, currentSlug, apiBasePath) : src;
  const [image, setImage] = useState<TheaterImageState | null>(null);

  if (!resolvedSrc || typeof resolvedSrc !== "string") {
    return <img alt={alt} className={className} src={resolvedSrc} {...props} />;
  }

  return (
    <>
      <button
        aria-label={alt ? `Open image: ${alt}` : "Open image"}
        className="wiki-theater-image-button"
        onClick={(event) => {
          const imageElement = event.currentTarget.querySelector("img");
          setImage(
            imageElement
              ? (imageStateFromElement(imageElement) ?? {
                  src: resolvedSrc,
                  alt: alt || "Image preview",
                })
              : { src: resolvedSrc, alt: alt || "Image preview" },
          );
        }}
        type="button"
      >
        <img
          alt={alt}
          className={classNames("wiki-theater-image", className)}
          data-theater-image=""
          src={resolvedSrc}
          {...props}
        />
      </button>
      {image ? (
        <ImageTheaterModal
          image={image}
          onClose={() => setImage(null)}
          onImageChange={setImage}
        />
      ) : null}
    </>
  );
}

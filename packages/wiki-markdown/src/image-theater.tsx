"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { resolveImageSrc } from "./paths";

type TheaterImageState = {
  src: string;
  alt: string;
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

function imageStateFromElement(image: HTMLImageElement): TheaterImageState | null {
  const src = image.currentSrc || image.src;
  if (!src || !isVisibleImage(image)) return null;

  return {
    src,
    alt: image.alt || "Image preview",
  };
}

function ImageTheaterModal({
  image,
  onClose,
}: {
  image: TheaterImageState;
  onClose: () => void;
}) {
  const downloadName = useMemo(() => getDownloadName(image.src), [image.src]);
  const closeOnMaskClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      aria-label={image.alt}
      aria-modal="true"
      className="wiki-image-theater"
      role="dialog"
    >
      <div className="wiki-image-theater__frame" onClick={closeOnMaskClick}>
        <div className="wiki-image-theater__toolbar">
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
    <ImageTheaterModal image={image} onClose={() => setImage(null)} />
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
        onClick={() => setImage({ src: resolvedSrc, alt: alt || "Image preview" })}
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
        <ImageTheaterModal image={image} onClose={() => setImage(null)} />
      ) : null}
    </>
  );
}

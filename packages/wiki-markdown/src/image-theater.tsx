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

function SingleTheaterImage({
  resolvedSrc,
  alt,
  className,
  ...props
}: ComponentProps<"img"> & { resolvedSrc: string; alt: string }) {
  const [image, setImage] = useState<TheaterImageState | null>(null);

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

export function TheaterImage({
  className,
  currentSlug,
  apiBasePath,
  src,
  alt = "",
  "data-theme-pair": themePairAttr,
  dataThemePair,
  ...props
}: ComponentProps<"img"> & {
  currentSlug?: string;
  apiBasePath?: string;
  // react-markdown may surface the raw HTML attribute either as the hyphenated
  // `data-theme-pair` or the camelCased `dataThemePair`, depending on version.
  "data-theme-pair"?: boolean | string;
  dataThemePair?: boolean | string;
}) {
  // Theme-pair images mirror the server renderer's expandThemeImages(): an
  // authored `<img data-theme-pair src="diagram-light.png">` becomes a light +
  // dark pair toggled by the `.dark` class, so the React (Vite) reader renders
  // identically to the SSR (Next.js) reader.
  const themePair = themePairAttr ?? dataThemePair;
  const isThemePair = themePair !== undefined && themePair !== false;
  const lightSuffix =
    isThemePair && typeof src === "string"
      ? src.match(/^(.*)-light(\.[a-zA-Z0-9]+)$/)
      : null;

  if (lightSuffix) {
    const darkSrc = `${lightSuffix[1]}-dark${lightSuffix[2]}`;
    const lightResolved = resolveImageSrc(lightSuffix[0], currentSlug, apiBasePath);
    const darkResolved = resolveImageSrc(darkSrc, currentSlug, apiBasePath);
    if (typeof lightResolved === "string" && typeof darkResolved === "string") {
      // The toggle class wraps the whole clickable unit (button + image) so the
      // hidden variant is fully removed from layout in the inactive theme.
      return (
        <>
          <span className="dark:hidden">
            <SingleTheaterImage
              {...props}
              alt={alt}
              className={className}
              resolvedSrc={lightResolved}
            />
          </span>
          <span className="hidden dark:block">
            <SingleTheaterImage
              {...props}
              alt={alt}
              className={className}
              resolvedSrc={darkResolved}
            />
          </span>
        </>
      );
    }
  }

  const resolvedSrc =
    typeof src === "string" ? resolveImageSrc(src, currentSlug, apiBasePath) : src;

  if (!resolvedSrc || typeof resolvedSrc !== "string") {
    return <img alt={alt} className={className} src={resolvedSrc} {...props} />;
  }

  return (
    <SingleTheaterImage
      {...props}
      alt={alt}
      className={className}
      resolvedSrc={resolvedSrc}
    />
  );
}

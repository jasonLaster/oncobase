"use client";

import { useCallback, useEffect, useEffectEvent, useMemo } from "react";
import { createPortal } from "react-dom";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer";
import { getDownloadName, type TheaterImageState } from "./image-theater-state";

export function ImageTheaterModal({
  image,
  ImageComponent = DefaultWikiImage,
  onImageChange,
  onClose,
}: {
  image: TheaterImageState;
  ImageComponent?: WikiImageComponent;
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
    <dialog
      aria-label={image.alt}
      aria-modal="true"
      className="wiki-image-theater"
      open
    >
      <button
        aria-label="Dismiss image preview"
        className="wiki-image-theater__scrim"
        onClick={onClose}
        type="button"
      />
      <div className="wiki-image-theater__frame">
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
        <div className="wiki-image-theater__stage">
          <ImageComponent
            alt={image.alt}
            className="wiki-image-theater__image"
            src={image.src}
          />
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer.tsx";
import { getDownloadName, type TheaterImageState } from "./image-theater-state.ts";

export function ImageTheaterModal({
  image,
  ImageComponent = DefaultWikiImage,
  opener,
  onImageChange,
  onClose,
}: {
  image: TheaterImageState;
  ImageComponent?: WikiImageComponent;
  opener?: HTMLElement | null;
  onImageChange?: (image: TheaterImageState) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
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
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onModalKeyDown);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={image.alt}
      aria-modal="true"
      className="wiki-image-theater"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        const target = event.target as Element;
        if (!target.closest("a, button, .wiki-image-theater__image, .wiki-image-theater__nav")) {
          onClose();
        }
      }}
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
        </div>
        <div className="wiki-image-theater__stage">
          <ImageComponent
            alt={image.alt}
            className="wiki-image-theater__image"
            src={image.src}
          />
        </div>
        <a
          aria-label="Download image"
          className="wiki-image-theater__button wiki-image-theater__button--icon wiki-image-theater__download"
          download={downloadName}
          href={image.src}
          title="Download image"
        >
          <svg aria-hidden="true" className="wiki-image-theater__icon" viewBox="0 0 24 24">
            <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
          </svg>
        </a>
      </div>
    </dialog>,
    document.body,
  );
}

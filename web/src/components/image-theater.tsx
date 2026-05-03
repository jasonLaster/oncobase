"use client";

/* eslint-disable @next/next/no-img-element -- Markdown images are arbitrary proxied assets, so next/image cannot know their dimensions. */

import { useEffect, useMemo, useState } from "react";
import type { ComponentProps, MouseEvent } from "react";
import { createPortal } from "react-dom";
import { DownloadIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TheaterImageState = {
  src: string;
  alt: string;
};

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
      className="fixed inset-0 z-[80] flex cursor-zoom-out bg-black/88 text-white backdrop-blur-sm"
      role="dialog"
    >
      <div className="flex min-h-0 w-full flex-col">
        <div
          className="flex h-14 shrink-0 items-center justify-end gap-2 px-3 sm:h-16 sm:px-4"
          onClick={closeOnMaskClick}
        >
          <a
            className={cn(
              buttonVariants({ size: "icon", variant: "outline" }),
              "border-white/15 bg-white/10 text-white hover:bg-white/18"
            )}
            download={downloadName}
            href={image.src}
            title="Download image"
          >
            <DownloadIcon />
            <span className="sr-only">Download image</span>
          </a>
          <Button
            aria-label="Close image preview"
            className="border-white/15 bg-white/10 text-white hover:bg-white/18"
            onClick={onClose}
            size="icon"
            title="Close"
            type="button"
            variant="outline"
          >
            <XIcon />
          </Button>
        </div>
        <div
          className="flex min-h-0 flex-1 items-center justify-center px-3 pb-5 sm:px-6 sm:pb-8"
          onClick={closeOnMaskClick}
        >
          <img
            alt={image.alt}
            className="max-h-full max-w-full cursor-default rounded-lg object-contain shadow-2xl shadow-black/60"
            src={image.src}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export function ImageTheater() {
  const [image, setImage] = useState<TheaterImageState | null>(null);

  useEffect(() => {
    const prose = document.querySelector<HTMLElement>(".prose");
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
  }, []);

  return image ? (
    <ImageTheaterModal image={image} onClose={() => setImage(null)} />
  ) : null;
}

export function TheaterImage({
  className,
  src,
  alt = "",
  ...props
}: ComponentProps<"img">) {
  const [image, setImage] = useState<TheaterImageState | null>(null);

  if (!src || typeof src !== "string") {
    return <img alt={alt} className={className} src={src} {...props} />;
  }

  return (
    <>
      <button
        aria-label={alt ? `Open image: ${alt}` : "Open image"}
        className="group block max-w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => setImage({ src, alt: alt || "Image preview" })}
        type="button"
      >
        <img
          alt={alt}
          className={cn("transition group-hover:brightness-95", className)}
          src={src}
          {...props}
        />
      </button>
      {image ? (
        <ImageTheaterModal image={image} onClose={() => setImage(null)} />
      ) : null}
    </>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  CarouselViewport,
} from "@oncobase/ui/carousel";
import { Dialog, DialogClose, DialogContent } from "@oncobase/ui/dialog";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer.tsx";
import { getDownloadName, type TheaterImageItem, type TheaterImageState } from "./image-theater-state.ts";

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
  const [open, setOpen] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const downloadName = useMemo(() => getDownloadName(image.src), [image.src]);
  const slideImages = Array.isArray(image.images) && image.images.length > 1 ? image.images : null;
  const slideIndex = slideImages && typeof image.index === "number" ? image.index : null;
  const slides = slideImages && slideIndex !== null ? { images: slideImages, index: slideIndex } : null;

  const toolbar = slides ? (
    <div className="wiki-image-theater__toolbar">
      <div className="wiki-image-theater__nav">
        <CarouselPrevious
          aria-label="Previous slide"
          className="wiki-image-theater__button wiki-image-theater__button--icon"
          title="Previous slide"
        >
          <span aria-hidden="true">&lt;</span>
        </CarouselPrevious>
        <span className="wiki-image-theater__status">{slides.index + 1} / {slides.images.length}</span>
        <CarouselNext
          aria-label="Next slide"
          className="wiki-image-theater__button wiki-image-theater__button--icon"
          title="Next slide"
        >
          <span aria-hidden="true">&gt;</span>
        </CarouselNext>
      </div>
    </div>
  ) : (
    <div className="wiki-image-theater__toolbar"><span /></div>
  );
  const download = (
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
  );
  const picture = (item: TheaterImageItem) => (
    <ImageComponent alt={item.alt} className="wiki-image-theater__image" src={item.src} />
  );

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => { if (!isOpen) onClose(); }}
      // Mount beside the page, as before: in place, the theater would join the article's text and click handlers.
      container={document.body}
    >
      <DialogContent
        aria-label={image.alt}
        className="wiki-image-theater"
        initialFocus={slides ? () => viewport.current : "auto"}
        finalFocus={() => (opener?.isConnected ? opener : null)}
      >
        <DialogClose aria-label="Dismiss image preview" className="wiki-image-theater__scrim" />
        {slides ? (
          <Carousel
            aria-label="Slides"
            className="wiki-image-theater__frame"
            loop
            page={slides.index + 1}
            onPageChange={(page) => {
              const next = slides.images[page - 1];
              if (next) onImageChange?.({ ...next, images: slides.images, index: page - 1 });
            }}
          >
            {toolbar}
            <CarouselViewport ref={viewport} className="wiki-image-theater__stage wiki-image-theater__stage--slides">
              <CarouselContent className="wiki-image-theater__slides">
                {slides.images.map((item) => (
                  <CarouselItem key={item.src} className="wiki-image-theater__slide">
                    {picture(item)}
                  </CarouselItem>
                ))}
              </CarouselContent>
            </CarouselViewport>
            {download}
          </Carousel>
        ) : (
          <div className="wiki-image-theater__frame">
            {toolbar}
            <div className="wiki-image-theater__stage">{picture(image)}</div>
            {download}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

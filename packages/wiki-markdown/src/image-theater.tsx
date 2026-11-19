"use client";

import { useEffect, useState } from "react";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer.tsx";
import { ImageTheaterPreview } from "./image-theater-preview.tsx";
import {
  imageStateFromElement,
  type TheaterImageState,
} from "./image-theater-state.ts";

export function ImageTheater({
  ImageComponent = DefaultWikiImage,
  scopeSelector = ".prose",
}: {
  ImageComponent?: WikiImageComponent;
  scopeSelector?: string;
}) {
  const [image, setImage] = useState<TheaterImageState | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const prose = document.querySelector<HTMLElement>(scopeSelector);
    if (!prose) return;

    const openImage = (target: EventTarget | null) => {
      const imageElement =
        target instanceof Element
          ? target.closest<HTMLImageElement>("img[data-theater-image]")
          : null;
      const nextImage = imageElement ? imageStateFromElement(imageElement) : null;
      if (!imageElement || !nextImage) return false;

      setOpener(imageElement);
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
    <ImageTheaterPreview
      ImageComponent={ImageComponent}
      image={image}
      opener={opener}
      onClose={() => setImage(null)}
      onImageChange={setImage}
    />
  ) : null;
}

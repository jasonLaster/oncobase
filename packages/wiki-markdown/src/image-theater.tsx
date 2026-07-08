"use client";

import { useEffect, useState } from "react";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer.tsx";
import { ImageTheaterModal } from "./image-theater-modal.tsx";
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
      ImageComponent={ImageComponent}
      image={image}
      onClose={() => setImage(null)}
      onImageChange={setImage}
    />
  ) : null;
}

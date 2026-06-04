"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer";
import { ImageTheaterModal } from "./image-theater-modal";
import {
  classNames,
  imageStateFromElement,
  type TheaterImageState,
} from "./image-theater-state";
import { resolveImageSrc } from "./paths";

export function TheaterImage({
  className,
  currentSlug,
  apiBasePath,
  ImageComponent = DefaultWikiImage,
  src,
  alt = "",
  ...props
}: ComponentProps<"img"> & {
  ImageComponent?: WikiImageComponent;
  currentSlug?: string;
  apiBasePath?: string;
}) {
  const resolvedSrc =
    typeof src === "string" ? resolveImageSrc(src, currentSlug, apiBasePath) : src;
  const [image, setImage] = useState<TheaterImageState | null>(null);

  if (!resolvedSrc || typeof resolvedSrc !== "string") {
    return (
      <DefaultWikiImage
        alt={alt}
        className={className}
        src={resolvedSrc}
        {...props}
      />
    );
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
        <ImageComponent
          alt={alt}
          className={classNames("wiki-theater-image", className)}
          data-theater-image=""
          src={resolvedSrc}
          {...props}
        />
      </button>
      {image ? (
        <ImageTheaterModal
          ImageComponent={ImageComponent}
          image={image}
          onClose={() => setImage(null)}
          onImageChange={setImage}
        />
      ) : null}
    </>
  );
}

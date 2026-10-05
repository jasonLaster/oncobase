"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import { DefaultWikiImage, type WikiImageComponent } from "./image-renderer.tsx";
import { ImageTheaterModal } from "./image-theater-modal.tsx";
import {
  classNames,
  imageStateFromElement,
  type TheaterImageState,
} from "./image-theater-state.ts";
import { resolveImageSrc } from "./paths.ts";

export function TheaterImage({
  className,
  currentSlug,
  apiBasePath,
  ImageComponent = DefaultWikiImage,
  src,
  alt = "",
  width,
  height,
  "data-theme-pair": themePair,
  themeVariant,
  ...props
}: ComponentProps<"img"> & {
  ImageComponent?: WikiImageComponent;
  currentSlug?: string;
  apiBasePath?: string;
  "data-theme-pair"?: string | boolean;
  themeVariant?: "light" | "dark";
}) {
  const resolvedSrc =
    typeof src === "string" ? resolveImageSrc(src, currentSlug, apiBasePath) : src;
  const [image, setImage] = useState<TheaterImageState | null>(null);

  if (themePair !== undefined && typeof resolvedSrc === "string" && /-light\.[a-zA-Z0-9]+$/.test(resolvedSrc)) {
    const shared = { ...props, alt, width, height, className, ImageComponent };
    return (
      <>
        <TheaterImage {...shared} src={resolvedSrc} themeVariant="light" />
        <TheaterImage {...shared} src={resolvedSrc.replace(/-light(\.[a-zA-Z0-9]+)$/, "-dark$1")} themeVariant="dark" />
      </>
    );
  }

  if (!resolvedSrc || typeof resolvedSrc !== "string") {
    return (
      <DefaultWikiImage
        alt={alt}
        className={className}
        src={resolvedSrc}
        width={width}
        height={height}
        {...props}
      />
    );
  }

  return (
    <>
      <button
        aria-label={alt ? `Open image: ${alt}` : "Open image"}
        className="wiki-theater-image-button"
        data-theme-variant={themeVariant}
        style={{ aspectRatio: Number(width) > 0 && Number(height) > 0 ? `${Number(width)} / ${Number(height)}` : "16 / 9" }}
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
          width={width}
          height={height}
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

"use client";

import Image from "next/image";
import type { ComponentProps, CSSProperties } from "react";
import {
  ImageTheater as BaseImageTheater,
  TheaterImage as BaseTheaterImage,
} from "@oncobase/wiki-markdown";
import type { WikiImageComponent } from "@oncobase/wiki-markdown";

export const NextWikiImage: WikiImageComponent = ({
  alt = "",
  className,
  height,
  loading,
  sizes,
  src,
  style,
  width,
  ...props
}: ComponentProps<"img">) => {
  if (typeof src !== "string" || !src) return null;

  const forwardedAttributes = Object.fromEntries(
    Object.entries(props).filter(([name]) =>
      name.startsWith("aria-") || name.startsWith("data-"),
    ),
  );

  return (
    <Image
      {...forwardedAttributes}
      alt={alt}
      className={className}
      height={typeof height === "number" ? height : 900}
      loading={loading === "eager" ? "eager" : "lazy"}
      sizes={sizes ?? "100vw"}
      src={src}
      style={{
        height: "100%",
        objectFit: "contain",
        width: "100%",
        ...(style as CSSProperties | undefined),
      }}
      unoptimized
      width={typeof width === "number" ? width : 1600}
    />
  );
};

export function ImageTheater(
  props: Omit<ComponentProps<typeof BaseImageTheater>, "ImageComponent">,
) {
  return <BaseImageTheater {...props} ImageComponent={NextWikiImage} />;
}

export function TheaterImage(
  props: Omit<ComponentProps<typeof BaseTheaterImage>, "ImageComponent">,
) {
  return <BaseTheaterImage {...props} ImageComponent={NextWikiImage} />;
}

"use client";

import type { ComponentProps } from "react";
import {
  SlidesViewer as BaseSlidesViewer,
  SlidesViewerControls,
} from "@oncobase/wiki-markdown";
import { NextWikiImage } from "@/components/image-theater";

export { SlidesViewerControls };

export function SlidesViewer(
  props: Omit<ComponentProps<typeof BaseSlidesViewer>, "ImageComponent">,
) {
  return <BaseSlidesViewer {...props} ImageComponent={NextWikiImage} />;
}

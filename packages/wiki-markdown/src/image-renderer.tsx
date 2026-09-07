"use client";

import { createElement } from "react";
import type { ComponentProps, ComponentType } from "react";

export type WikiImageComponent = ComponentType<ComponentProps<"img">>;

export function DefaultWikiImage({ loading = "lazy", decoding = "async", ...props }: ComponentProps<"img">) {
  return createElement("img", { loading, decoding, ...props });
}

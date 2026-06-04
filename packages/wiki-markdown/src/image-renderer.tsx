"use client";

import { createElement } from "react";
import type { ComponentProps, ComponentType } from "react";

export type WikiImageComponent = ComponentType<ComponentProps<"img">>;

export function DefaultWikiImage(props: ComponentProps<"img">) {
  return createElement("img", props);
}

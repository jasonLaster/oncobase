"use client";

import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  WIKI_COMPONENT_HEIGHT_MESSAGE,
  WIKI_COMPONENT_SANDBOX,
  resolveWikiComponentSrc,
} from "./mdx-components.ts";
import { ScenarioWaterfall } from "./scenario-waterfall.tsx";
import { SlidesViewer } from "./slides-viewer.tsx";

// biome-ignore lint/suspicious/noExplicitAny: registry components take arbitrary literal props.
export type WikiMdxComponents = Record<string, ComponentType<any>>;

/** React components every host can import from "@oncobase/wiki-markdown" in MDX. */
export const BUILT_IN_WIKI_MDX_COMPONENTS: WikiMdxComponents = { ScenarioWaterfall, SlidesViewer };

type HastProperties = Record<string, unknown>;

/** A sandboxed HTML component that may report its own height. */
function HtmlComponentFrame({ src, title, height }: { src: string; title: string; height: number }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // The sandboxed frame has an opaque origin, so match the sender window.
      if (event.source !== ref.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type !== WIKI_COMPONENT_HEIGHT_MESSAGE || typeof data.height !== "number") return;
      if (data.height >= 40 && data.height <= 4000) setMeasured(Math.ceil(data.height));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <iframe
      ref={ref}
      className="wiki-component-frame"
      data-test-id="wiki-component-frame"
      title={title}
      src={src}
      height={measured ?? height}
      width="100%"
      loading="lazy"
      sandbox={WIKI_COMPONENT_SANDBOX}
      referrerPolicy="no-referrer"
    />
  );
}

export function WikiComponentFigure({
  properties,
  children,
  currentSlug,
  apiBasePath,
  components,
}: {
  properties: HastProperties;
  children?: ReactNode;
  currentSlug?: string;
  apiBasePath: string;
  components?: WikiMdxComponents;
}) {
  const name = String(properties.dataWikiComponent ?? "");
  const kind = properties.dataWikiComponentKind;
  const title = String(properties.dataWikiComponentTitle ?? name);
  // The fallback image (children) stays in the DOM for print; CSS hides it on screen.
  const fallback = children ? <div className="wiki-component-fallback">{children}</div> : null;
  let live: ReactNode;
  if (kind === "html") {
    let src: string | null = null;
    try { src = resolveWikiComponentSrc(String(properties.dataWikiComponentSrc ?? ""), currentSlug, apiBasePath); } catch { src = null; }
    live = src
      ? <HtmlComponentFrame src={src} title={title} height={Number(properties.dataWikiComponentHeight) || 480} />
      : <div className="wiki-component-error" role="note">Component error: {name} must be an .html file in a components/ folder</div>;
  } else {
    const exportName = String(properties.dataWikiComponentExport ?? name);
    const Component = components?.[exportName] ?? BUILT_IN_WIKI_MDX_COMPONENTS[exportName];
    let props: Record<string, unknown> = {};
    try { props = JSON.parse(String(properties.dataWikiComponentProps ?? "{}")); } catch { /* invalid props render without them */ }
    const { fallback: _fallback, alt: _alt, ...componentProps } = props;
    live = Component
      ? <Component currentSlug={currentSlug} {...componentProps} />
      : <div className="wiki-component-error" role="note">Component error: {exportName} is not available on this site</div>;
  }
  return (
    <figure className="wiki-component" data-wiki-component={name} data-test-id="wiki-component">
      <div className="wiki-component-live">{live}</div>
      {fallback}
    </figure>
  );
}

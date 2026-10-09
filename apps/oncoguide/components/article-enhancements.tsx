"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { MarkdownHeadingAnchors } from "@oncobase/wiki-markdown/heading-anchors";
import { ImageTheater } from "@oncobase/wiki-markdown/image-theater";
const SmartTableEnhancer = dynamic(() => import("@oncobase/smart-table").then(module => module.SmartTableEnhancer));
const SlidesViewerControls = dynamic(() => import("@oncobase/wiki-markdown/slides-viewer").then(module => module.SlidesViewerControls));
export function ArticleEnhancements({ slug, tables, slides }: { slug: string; tables: boolean; slides: boolean }) {
  const router = useRouter();
  const adapter = useMemo(() => ({ push: (href: string, options?: { scroll?: boolean }) => router.push(href, options) }), [router]);
  return <>
    <MarkdownHeadingAnchors scopeKey={slug} routeAdapter={adapter} />
    <ImageTheater scopeSelector="[data-guide-markdown]" />
    {tables ? <SmartTableEnhancer /> : null}
    {slides ? <SlidesViewerControls scopeSelector="[data-guide-markdown]" /> : null}
  </>;
}

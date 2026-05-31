"use client";

import Link from "next/link";
import { lazy, Suspense, type AnchorHTMLAttributes } from "react";
import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import rehypeKatex from "rehype-katex";
import type { ChatMarkdownRendererProps } from "@oncobase/chat";
import {
  MarkdownPre,
  MdTable,
  MdTbody,
  MdTd,
  MdTh,
  MdThead,
  MdTr,
  markdownRemarkPlugins,
  preprocessCitationMarkdown,
  resolveWikilinks,
} from "@oncobase/wiki-markdown";
import type { WikiMermaidGanttMarker } from "@oncobase/wiki-markdown/mermaid";
import { MarkdownRendererClient } from "@/components/markdown-renderer-client";
import { RoutedAnchorLinks } from "@/components/markdown-heading-anchors";
import {
  isInternalChatResponseHref,
  resolveChatResponseHref,
} from "@/lib/chat-response-links";

const STREAMDOWN_DISABLED = process.env.NEXT_PUBLIC_CHAT_STREAMDOWN === "0";
const chatRehypePlugins = [rehypeKatex];

const MERMAID_FENCE_PATTERN = /(^|\n)\s*```mermaid\s*(\n|$)/;
const CHAT_GANTT_MARKERS: WikiMermaidGanttMarker[] = [
  { date: "2026-07-14", label: "Phase 2 (12 weeks)" },
  { date: "2026-09-10", label: "Surgery" },
];
const CHAT_GANTT_REFERENCE_YEAR = 2026;

const LazyMermaidRenderer = lazy(() =>
  import("@oncobase/wiki-markdown/mermaid").then((module) => ({
    default: module.WikiMermaidRenderer,
  })),
);

function ChatMermaidRendererSlot({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  // While a response is still streaming the mermaid block can be incomplete;
  // skip the rich renderer until the stream finishes so the fallback shows
  // the partial source instead of a broken SVG. Once streaming completes the
  // renderer mounts, finds the `data-graph` fallback that `MarkdownPre`
  // already produced, and upgrades it into the themed SVG.
  if (isStreaming) return null;
  if (!MERMAID_FENCE_PATTERN.test(content)) return null;
  return (
    <Suspense fallback={null}>
      <LazyMermaidRenderer
        ganttAxisReferenceYear={CHAT_GANTT_REFERENCE_YEAR}
        ganttMarkers={CHAT_GANTT_MARKERS}
      />
    </Suspense>
  );
}

export function WikiChatMarkdownRenderer({
  content,
  disableAnchors,
  isStreaming = false,
}: ChatMarkdownRendererProps) {
  if (STREAMDOWN_DISABLED) {
    return (
      <MarkdownRendererClient content={content} disableAnchors={disableAnchors} />
    );
  }

  const resolved = resolveWikilinks(content);
  const citationLinked = preprocessCitationMarkdown(resolved);
  const components = {
    a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
      const resolvedHref = resolveChatResponseHref(href);

      if (isInternalChatResponseHref(resolvedHref)) {
        return (
          <Link href={resolvedHref} {...props}>
            {children}
          </Link>
        );
      }

      return (
        <a href={resolvedHref} {...props}>
          {children}
        </a>
      );
    },
    pre: MarkdownPre,
    table: MdTable,
    thead: MdThead,
    tbody: MdTbody,
    tr: MdTr,
    th: MdTh,
    td: MdTd,
  } as unknown as StreamdownComponents;

  return (
    <div className="prose min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        caret={isStreaming ? "block" : undefined}
        skipHtml
        controls={false}
        parseIncompleteMarkdown={isStreaming}
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={chatRehypePlugins}
        components={components}
      >
        {citationLinked}
      </Streamdown>
      <ChatMermaidRendererSlot content={content} isStreaming={isStreaming} />
      <RoutedAnchorLinks />
    </div>
  );
}

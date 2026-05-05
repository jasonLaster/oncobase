"use client";

import { memo, useState } from "react";
import Link from "next/link";
import {
  DefaultToolCallBlock,
  getChatToolInfo,
  type ChatSourceExtractor,
  type ChatToolCallRendererProps,
} from "@diana-tnbc/chat";

function hrefForPage(value: string | undefined, fallback?: string) {
  const raw = value ?? fallback;
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

const ReadPageBadge = memo(function ReadPageBadge({
  input,
  output,
  done,
}: {
  input: Record<string, unknown>;
  output: unknown;
  done: boolean;
}) {
  const slug = (input?.slug as string) || "";
  const result = output as { title?: string; slug?: string; href?: string; error?: string } | null;
  const title = result?.title || slug.split("/").pop() || slug;
  const hasError = result?.error;

  return (
    <Link
      href={hrefForPage(result?.href, slug)}
      className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs transition-colors ${
        done && !hasError
          ? "text-[var(--text-muted)] hover:text-[var(--brand)]"
          : done && hasError
            ? "text-red-500"
            : "text-[var(--text-muted)]"
      }`}
    >
      {!done ? (
        <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--text-muted)] border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-40">
          <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
        </svg>
      )}
      <span className="min-w-0 max-w-full truncate">
        {done ? `Read ${title}` : `Reading ${slug}...`}
      </span>
    </Link>
  );
});

const SearchResultsBlock = memo(function SearchResultsBlock({
  output,
  done,
  query,
}: {
  output: unknown;
  done: boolean;
  query: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const results = (Array.isArray(output) ? output : []) as Array<{
    slug?: string;
    title?: string;
    href?: string;
  }>;

  if (!query && results.length === 0) return null;

  return (
    <div className="min-w-0 max-w-full">
      <button
        onClick={() => done && setExpanded(!expanded)}
        className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-left text-xs transition-colors ${
          done
            ? "text-[var(--text-muted)] hover:text-[var(--foreground)]"
            : "text-[var(--text-muted)]"
        }`}
      >
        {!done ? (
          <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--text-muted)] border-t-transparent rounded-full animate-spin shrink-0" />
        ) : (
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-40">
            <path d="M15.25 14.19l-4.06-4.06a5.5 5.5 0 1 0-1.06 1.06l4.06 4.06a.75.75 0 1 0 1.06-1.06zM2 6.5a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0z" />
          </svg>
        )}
        <span className="min-w-0 truncate">
          {!done
            ? query
              ? `Searching "${query}"...`
              : "Searching..."
            : `Searched "${query}" - ${results.length} result${results.length !== 1 ? "s" : ""}`}
        </span>
        {done && results.length > 0 && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`shrink-0 opacity-30 transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
        )}
      </button>
      {expanded && results.length > 0 && (
        <div className="mt-0.5 ml-4 min-w-0 max-w-[calc(100%-1rem)] space-y-0 border-l border-[var(--sidebar-border)] pl-2">
          {results.map((result, i) => (
            <Link
              key={i}
              href={hrefForPage(result.href, result.slug)}
              className="flex min-w-0 max-w-full items-center gap-1.5 py-0.5 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--brand)]"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-40">
                <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
              </svg>
              <span className="min-w-0 truncate">{result.title || result.slug}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
});

export function DianaChatToolRenderer({
  toolName,
  state,
  input,
  output,
  done,
}: ChatToolCallRendererProps) {
  const inputObj = (input || {}) as Record<string, unknown>;

  if (toolName === "read_page") {
    return <ReadPageBadge input={inputObj} output={output} done={done} />;
  }

  if (toolName === "search_wiki") {
    return (
      <SearchResultsBlock
        output={output}
        done={done}
        query={(inputObj.query as string) || ""}
      />
    );
  }

  return <DefaultToolCallBlock toolName={toolName} state={state} />;
}

export const extractDianaChatSources: ChatSourceExtractor = (parts) => {
  const seen = new Set<string>();
  const sources: ReturnType<ChatSourceExtractor> = [];

  for (const part of parts) {
    const info = getChatToolInfo(part as Record<string, unknown>);
    if (!info || info.state !== "output-available") continue;

    if (info.toolName === "read_page" && info.output && typeof info.output === "object") {
      const output = info.output as {
        slug?: string;
        title?: string;
        href?: string;
        anchor?: string;
        error?: string;
      };
      const href = hrefForPage(output.href, output.slug);
      if (output.slug && output.title && !output.error && !seen.has(href)) {
        seen.add(href);
        sources.push({
          id: href,
          title: output.title,
          href,
        });
      }
    }

    if (info.toolName === "search_wiki" && Array.isArray(info.output)) {
      for (const item of info.output as Array<{ slug?: string; title?: string; href?: string }>) {
        const href = hrefForPage(item.href, item.slug);
        if (item.slug && item.title && !seen.has(href)) {
          seen.add(href);
          sources.push({
            id: href,
            title: item.title,
            href,
          });
        }
      }
    }
  }

  return sources;
};

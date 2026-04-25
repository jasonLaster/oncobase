"use client";

/**
 * Message tree for the chat page. Phase 4 of the chat-performance plan.
 *
 * The render contract:
 *
 *   <PriorMessages messages={...} ... />   // memoized list. zero commits per
 *                                            //  streamed token.
 *   <StreamingMessage message={last} />     // the only thing that re-renders
 *                                            //  while the assistant types.
 *
 * `<PriorMessages>` is memoized on `(messages.length, last id)`. As long as
 * useChat keeps prior message references stable (which it does — it appends
 * new tokens to the trailing message only), we render each prior message at
 * most once per its lifetime.
 */

import type { UIMessage } from "ai";
import { memo, useState } from "react";
import { StreamingMarkdown } from "@/components/chat/streaming-markdown";

export interface ChatUIMessage extends UIMessage {
  dbId?: string;
  disabled?: boolean;
}

// ---------------- part renderers (each individually memoized) ----------------

const ReasoningBlock = memo(function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
      >
        <span className="text-[10px]">{open ? "▼" : "▶"}</span>
        <span className="italic">Reasoning</span>
      </button>
      {open && (
        <div className="mt-1 pl-3 border-l-2 border-[var(--sidebar-border)] text-xs text-[var(--text-muted)] whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
});

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
  const result = output as { title?: string; slug?: string; error?: string } | null;
  const title = result?.title || slug.split("/").pop() || slug;
  const hasError = result?.error;

  return (
    <a
      href={`/${slug}`}
      className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
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
      <span className="truncate max-w-[250px]">{done ? `Read ${title}` : `Reading ${slug}...`}</span>
    </a>
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
  const results = (Array.isArray(output) ? output : []) as Array<{ slug?: string; title?: string }>;

  if (!query && results.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => done && setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 text-xs transition-colors text-left ${
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
        <span className="truncate">
          {!done
            ? query
              ? `Searching "${query}"...`
              : "Searching..."
            : `Searched "${query}" — ${results.length} result${results.length !== 1 ? "s" : ""}`}
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
        <div className="mt-0.5 ml-4 pl-2 border-l border-[var(--sidebar-border)] space-y-0">
          {results.map((r, i) => (
            <a
              key={i}
              href={`/${r.slug}`}
              className="flex items-center gap-1.5 text-xs py-0.5 text-[var(--text-muted)] hover:text-[var(--brand)] transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-40">
                <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
              </svg>
              <span className="truncate">{r.title || r.slug}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
});

const ToolCallBlock = memo(function ToolCallBlock({
  toolName,
  state,
  output,
  input,
}: {
  toolName: string;
  state: string;
  output?: unknown;
  input?: unknown;
}) {
  const done = state === "output-available" || state === "output-error";
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
  const label = done ? `Used ${toolName}` : `Running ${toolName}...`;
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      {!done ? (
        <span className="inline-block w-3 h-3 border-[1.5px] border-[var(--text-muted)] border-t-transparent rounded-full animate-spin shrink-0" />
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 opacity-40">
          <polyline points="4 8 7 11 12 5" />
        </svg>
      )}
      <span>{label}</span>
    </div>
  );
});

const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="prose text-sm max-w-none">
      <StreamingMarkdown disableAnchors content={content} />
    </div>
  );
});

const SourceLinks = memo(function SourceLinks({
  pages,
}: {
  pages: Array<{ slug: string; title: string }>;
}) {
  if (pages.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-[var(--sidebar-border)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
        Sources
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pages.map((page) => (
          <a
            key={page.slug}
            href={`/${page.slug}`}
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-[var(--background)] border border-[var(--sidebar-border)] text-[var(--brand)] hover:border-[var(--brand)] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-50">
              <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
            </svg>
            {page.title}
          </a>
        ))}
      </div>
    </div>
  );
});

// ---------------- helpers ----------------

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function getToolInfo(part: Record<string, unknown>) {
  const type = part.type as string;
  if (type === "dynamic-tool" || type.startsWith("tool-")) {
    return {
      toolName: (part.toolName as string) || type.replace("tool-", ""),
      state: (part.state as string) || "call",
      output: part.output,
      input: part.input,
    };
  }
  return null;
}

export function extractSourcePages(parts: UIMessage["parts"]) {
  const seen = new Set<string>();
  const pages: Array<{ slug: string; title: string }> = [];
  for (const part of parts) {
    const info = getToolInfo(part as Record<string, unknown>);
    if (!info || info.state !== "output-available") continue;
    if (info.toolName === "read_page" && info.output && typeof info.output === "object") {
      const o = info.output as { slug?: string; title?: string; error?: string };
      if (o.slug && o.title && !o.error && !seen.has(o.slug)) {
        seen.add(o.slug);
        pages.push({ slug: o.slug, title: o.title });
      }
    }
    if (info.toolName === "search_wiki" && Array.isArray(info.output)) {
      for (const item of info.output as Array<{ slug?: string; title?: string }>) {
        if (item.slug && item.title && !seen.has(item.slug)) {
          seen.add(item.slug);
          pages.push({ slug: item.slug, title: item.title });
        }
      }
    }
  }
  return pages;
}

type PartGroup =
  | { kind: "text"; texts: string[] }
  | { kind: "tools"; parts: Array<{ type: string; [k: string]: unknown }> }
  | { kind: "other"; part: { type: string; [k: string]: unknown } };

export function groupParts(
  parts: Array<{ type: string; [k: string]: unknown }>
): PartGroup[] {
  const groups: PartGroup[] = [];
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      const last = groups[groups.length - 1];
      if (last?.kind === "text") {
        last.texts.push(part.text as string);
      } else {
        groups.push({ kind: "text", texts: [part.text as string] });
      }
    } else if (isToolPart(part as { type: string })) {
      const last = groups[groups.length - 1];
      if (last?.kind === "tools") {
        last.parts.push(part);
      } else {
        groups.push({ kind: "tools", parts: [part] });
      }
    } else {
      groups.push({ kind: "other", part });
    }
  }
  return groups;
}

// ---------------- assistant + user message rows ----------------

function AssistantMessageImpl({ message }: { message: UIMessage }) {
  const parts = message.parts;
  const sourcePages = extractSourcePages(parts);
  const hasText = parts.some((p) => p.type === "text" && p.text);
  const hasReasoning = parts.some((p) => p.type === "reasoning");
  const hasToolParts = parts.some((p) => isToolPart(p));
  if (!hasText && !hasReasoning && !hasToolParts) return null;

  const groups = groupParts(parts as Array<{ type: string; [k: string]: unknown }>);

  return (
    <div className="text-sm space-y-3">
      {groups.map((group, i) => {
        if (group.kind === "text") {
          return <MessageMarkdown key={i} content={group.texts.join("\n\n")} />;
        }
        if (group.kind === "tools") {
          return (
            <div key={i} className="space-y-1 py-1">
              {group.parts.map((part, j) => {
                const info = getToolInfo(part as Record<string, unknown>);
                if (!info) return null;
                return (
                  <ToolCallBlock
                    key={j}
                    toolName={info.toolName}
                    state={info.state}
                    output={info.output}
                    input={info.input}
                  />
                );
              })}
            </div>
          );
        }
        const { part } = group;
        if (part.type === "reasoning") {
          return <ReasoningBlock key={i} text={(part as { type: "reasoning"; text: string }).text} />;
        }
        return null;
      })}
      <SourceLinks pages={sourcePages} />
    </div>
  );
}

/** Memoized assistant row. Re-renders only when its message reference changes. */
export const AssistantMessage = memo(AssistantMessageImpl, (a, b) => a.message === b.message);

interface UserMessageRowProps {
  message: ChatUIMessage;
  onEdit: (text: string, msg: ChatUIMessage) => void;
}

function UserMessageRowImpl({ message, onEdit }: UserMessageRowProps) {
  const text = message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
  return (
    <div
      className={`group/msg border-t border-[var(--sidebar-border)] pt-4 ${message.disabled ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap flex-1 ${
            message.disabled
              ? "bg-[var(--sidebar-border)] text-[var(--text-muted)] line-through"
              : "bg-[var(--accent-light)] text-[var(--brand)]"
          }`}
        >
          {text}
        </div>
        <button
          onClick={() => onEdit(text, message)}
          title="Edit message"
          aria-label="Edit message"
          className="shrink-0 mt-2 p-0.5 rounded opacity-0 group-hover/msg:opacity-100 hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.5 2.5l2 2L5 13H3v-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export const UserMessageRow = memo(UserMessageRowImpl, (a, b) =>
  a.message === b.message && a.onEdit === b.onEdit
);

// ---------------- list ----------------

interface PriorMessagesProps {
  messages: ChatUIMessage[];
  onEditUser: (text: string, msg: ChatUIMessage) => void;
}

function PriorMessagesImpl({ messages, onEditUser }: PriorMessagesProps) {
  return (
    <>
      {messages.map((message) => {
        if (message.role === "user") {
          return (
            <UserMessageRow
              key={message.id}
              message={message}
              onEdit={onEditUser}
            />
          );
        }
        return <AssistantMessage key={message.id} message={message} />;
      })}
    </>
  );
}

/**
 * Memoized list of all-but-the-streaming-message. Equality is intentionally
 * loose: re-render only when the array length or the trailing id changes.
 * useChat keeps prior message references stable, so this is safe — the inner
 * AssistantMessage / UserMessageRow memos catch any deeper diffs we missed.
 */
export const PriorMessages = memo(PriorMessagesImpl, (prev, next) => {
  if (prev.onEditUser !== next.onEditUser) return false;
  if (prev.messages.length !== next.messages.length) return false;
  if (prev.messages.length === 0) return true;
  const lastA = prev.messages[prev.messages.length - 1];
  const lastB = next.messages[next.messages.length - 1];
  return lastA.id === lastB.id && lastA === lastB;
});

interface StreamingMessageProps {
  message: ChatUIMessage;
}

/**
 * The current streaming message. Re-renders per throttled token tick. NOT
 * memoized — that's the whole point: it owns the per-token render budget.
 */
export function StreamingMessage({ message }: StreamingMessageProps) {
  return <AssistantMessageImpl message={message} />;
}

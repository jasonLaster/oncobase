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
import { memo, useMemo, useState } from "react";
import { StreamingMarkdown } from "./streaming-markdown";
import { useChatRuntime } from "../runtime";
import type { ChatSource, ChatToolCallRendererProps } from "../types";

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

export const DefaultToolCallBlock = memo(function DefaultToolCallBlock({
  toolName,
  state,
}: {
  toolName: string;
  state: string;
}) {
  const done = state === "output-available" || state === "output-error";
  const readableName = toolName.replace(/[-_]+/g, " ");
  const label = done ? `Used ${readableName}` : `Running ${readableName}...`;
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

const ToolCallBlock = memo(function ToolCallBlock({
  toolName,
  state,
  output,
  input,
}: Omit<ChatToolCallRendererProps, "done">) {
  const done = state === "output-available" || state === "output-error";
  const { ToolCallRenderer } = useChatRuntime();

  if (ToolCallRenderer) {
    return (
      <ToolCallRenderer
        toolName={toolName}
        state={state}
        done={done}
        output={output}
        input={input}
      />
    );
  }

  return <DefaultToolCallBlock toolName={toolName} state={state} />;
});

const MessageMarkdown = memo(function MessageMarkdown({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const { MarkdownRenderer = StreamingMarkdown } = useChatRuntime();
  return (
    <div className="prose text-sm max-w-none">
      <MarkdownRenderer
        disableAnchors
        content={content}
        isStreaming={isStreaming}
      />
    </div>
  );
});

const SourceLinks = memo(function SourceLinks({
  sources,
}: {
  sources: ChatSource[];
}) {
  const { copy } = useChatRuntime();
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-[var(--sidebar-border)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">
        {copy.sourcesLabel}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((source) => {
          const content = (
            <>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 opacity-50">
                <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
              </svg>
              {source.title}
            </>
          );
          const className =
            "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-[var(--background)] border border-[var(--sidebar-border)] text-[var(--brand)] hover:border-[var(--brand)] transition-colors";
          const key = source.id ?? source.href ?? source.title;

          return source.href ? (
            <a key={key} href={source.href} className={className}>
              {content}
            </a>
          ) : (
            <span key={key} className={className}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
});

// ---------------- helpers ----------------

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export function getChatToolInfo(part: Record<string, unknown>) {
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

function sourceFromRecord(record: Record<string, unknown>): ChatSource | null {
  const title =
    typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : null;
  const href =
    typeof record.href === "string"
      ? record.href
      : typeof record.url === "string"
        ? record.url
        : undefined;
  if (!title) return null;
  return {
    id:
      typeof record.id === "string"
        ? record.id
        : href ?? title,
    title,
    href,
  };
}

function collectSources(value: unknown): ChatSource[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectSources);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const ownSource = sourceFromRecord(record);
  const nestedSources = Array.isArray(record.sources)
    ? record.sources.flatMap(collectSources)
    : [];
  return ownSource ? [ownSource, ...nestedSources] : nestedSources;
}

export function extractSourcesFromToolOutputs(parts: UIMessage["parts"]) {
  const seen = new Set<string>();
  const sources: ChatSource[] = [];
  for (const part of parts) {
    const info = getChatToolInfo(part as Record<string, unknown>);
    if (!info || info.state !== "output-available") continue;
    for (const source of collectSources(info.output)) {
      const key = source.id ?? source.href ?? source.title;
      if (!seen.has(key)) {
        seen.add(key);
        sources.push(source);
      }
    }
  }
  return sources;
}

export const extractSourcePages = extractSourcesFromToolOutputs;

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

function AssistantMessageImpl({
  message,
  onRegenerate,
  showActions = true,
  isStreaming = false,
}: {
  message: UIMessage;
  onRegenerate?: (messageId: string) => void;
  showActions?: boolean;
  /**
   * True only for the assistant row that is currently receiving tokens.
   * Threaded down to the markdown wrapper so Streamdown runs in
   * `mode="streaming"` with a caret. Completed rows render as static.
   */
  isStreaming?: boolean;
}) {
  const { extractSources = extractSourcesFromToolOutputs } = useChatRuntime();
  const parts = message.parts;
  // Memoize derivations on the parts ref. The streaming-tail message
  // re-renders per token-batch; without these memos, source extraction and
  // groupParts both walk all parts on every commit. With memos, they only
  // run when parts identity actually changes (which useChat does on append).
  const sources = useMemo(
    () => extractSources(parts),
    [parts, extractSources]
  );
  const groups = useMemo(
    () => groupParts(parts as Array<{ type: string; [k: string]: unknown }>),
    [parts]
  );
  const hasContent = useMemo(
    () => parts.some((p) => (p.type === "text" && p.text) || p.type === "reasoning" || isToolPart(p)),
    [parts]
  );
  // Concatenate all text parts for copy-to-clipboard.
  const fullText = useMemo(
    () =>
      parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n\n"),
    [parts]
  );
  if (!hasContent) return null;

  return (
    <div className="group/assistant text-sm space-y-3" data-slot="assistant-message">
      {groups.map((group, i) => {
        if (group.kind === "text") {
          return (
            <MessageMarkdown
              key={i}
              content={group.texts.join("\n\n")}
              isStreaming={isStreaming}
            />
          );
        }
        if (group.kind === "tools") {
          return (
            <div key={i} className="space-y-1 py-1">
              {group.parts.map((part, j) => {
                const info = getChatToolInfo(part as Record<string, unknown>);
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
      <SourceLinks sources={sources} />
      {showActions && fullText && (
        <AssistantMessageActions
          text={fullText}
          messageId={message.id}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  );
}

/** Memoized assistant row. Re-renders only when its message reference changes. */
export const AssistantMessage = memo(
  AssistantMessageImpl,
  (a, b) =>
    a.message === b.message &&
    a.onRegenerate === b.onRegenerate &&
    a.showActions === b.showActions &&
    a.isStreaming === b.isStreaming
);

function AssistantMessageActionsImpl({
  text,
  messageId,
  onRegenerate,
}: {
  text: string;
  messageId: string;
  onRegenerate?: (messageId: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 opacity-0 group-hover/assistant:opacity-100 transition-opacity"
      data-slot="assistant-message-actions"
    >
      <CopyButton text={text} />
      {onRegenerate && (
        <RegenerateButton onClick={() => onRegenerate(messageId)} />
      )}
    </div>
  );
}
const AssistantMessageActions = memo(AssistantMessageActionsImpl);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in insecure contexts; fail silently.
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied!" : "Copy message"}
      aria-label={copied ? "Copied" : "Copy message"}
      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="9" height="9" rx="1" />
          <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
        </svg>
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function RegenerateButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Regenerate this response"
      aria-label="Regenerate response"
      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2v4h-4M2 14v-4h4" />
        <path d="M13.5 6.5A6 6 0 0 0 4 4M2.5 9.5A6 6 0 0 0 12 12" />
      </svg>
      <span>Regenerate</span>
    </button>
  );
}

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
  onRegenerate?: (messageId: string) => void;
}

function PriorMessagesImpl({ messages, onEditUser, onRegenerate }: PriorMessagesProps) {
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
        return (
          <AssistantMessage
            key={message.id}
            message={message}
            onRegenerate={onRegenerate}
          />
        );
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
  if (prev.onRegenerate !== next.onRegenerate) return false;
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
 * Actions (Copy/Regenerate) are hidden on the streaming tail; they appear
 * only on committed messages.
 */
export function StreamingMessage({ message }: StreamingMessageProps) {
  return (
    <AssistantMessageImpl message={message} showActions={false} isStreaming />
  );
}

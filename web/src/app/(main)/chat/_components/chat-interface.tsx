"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRef, useEffect, useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { ChatBottomActions } from "./chat-actions";

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function storedToUIMessages(
  msgs: Array<{ role: "user" | "assistant"; content: string; parts?: string }>
): UIMessage[] {
  // Filter out empty assistant messages
  const cleaned = msgs.filter((m) => m.role === "user" || m.content || m.parts);

  return cleaned.map((m, i) => ({
    id: `stored-${i}`,
    role: m.role,
    parts: m.parts
      ? (JSON.parse(m.parts) as UIMessage["parts"])
      : [{ type: "text" as const, text: m.content }],
  }));
}

function ReasoningBlock({ text }: { text: string }) {
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
}

function ToolCallBlock({
  toolName,
  state,
}: {
  toolName: string;
  state: string;
}) {
  const done = state === "output-available" || state === "output-error";
  const label = done
    ? `Used ${toolName}`
    : state === "input-available"
      ? `Calling ${toolName}...`
      : `Running ${toolName}...`;

  return (
    <div className="flex items-center gap-1.5 my-1 text-xs text-[var(--text-muted)]">
      {!done && (
        <span className="inline-block w-3 h-3 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
      )}
      {done && <span className="text-[10px]">✓</span>}
      <span className="italic">{label}</span>
    </div>
  );
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function getToolInfo(part: Record<string, unknown>): {
  toolName: string;
  state: string;
  output: unknown;
} | null {
  const type = part.type as string;
  if (type === "dynamic-tool") {
    return {
      toolName: (part.toolName as string) || "unknown",
      state: (part.state as string) || "call",
      output: part.output,
    };
  }
  if (type.startsWith("tool-")) {
    return {
      toolName: type.replace("tool-", ""),
      state: (part.state as string) || "call",
      output: part.output,
    };
  }
  return null;
}

function extractSourcePages(
  parts: UIMessage["parts"]
): Array<{ slug: string; title: string }> {
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

function SourceLinks({
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
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="shrink-0 opacity-50"
            >
              <path d="M13.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h12l.5-.5v-10L13.5 3zm-.51 8.49V13h-11V3h4.29l.85.85.36.15H13v7.49z" />
            </svg>
            {page.title}
          </a>
        ))}
      </div>
    </div>
  );
}

function AssistantMessage({ message, isLive }: { message: UIMessage; isLive?: boolean }) {
  const parts = message.parts;
  const sourcePages = extractSourcePages(parts);
  const hasText = parts.some((p) => p.type === "text" && p.text);
  const hasReasoning = parts.some((p) => p.type === "reasoning");
  const hasToolParts = parts.some((p) => isToolPart(p));
  const allToolsDone = hasToolParts && parts.filter(isToolPart).every((p) => {
    const info = getToolInfo(p as Record<string, unknown>);
    return info?.state === "output-available" || info?.state === "output-error";
  });

  // Skip truly empty messages
  if (!hasText && !hasReasoning && !hasToolParts) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-[var(--accent-light)] text-[var(--foreground)] text-sm">
        {parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div key={i} className="prose text-sm">
                <MarkdownRenderer content={part.text} />
              </div>
            );
          }
          if (part.type === "reasoning") {
            return <ReasoningBlock key={i} text={(part as { type: "reasoning"; text: string }).text} />;
          }
          if (isToolPart(part)) {
            const info = getToolInfo(part as Record<string, unknown>);
            if (!info) return null;
            return (
              <ToolCallBlock key={i} toolName={info.toolName} state={info.state} />
            );
          }
          return null;
        })}
        {/* Show generating indicator when tools are done but text hasn't started */}
        {isLive && !hasText && allToolsDone && (
          <div className="flex items-center gap-1.5 mt-1 text-xs text-[var(--text-muted)]">
            <span className="inline-block w-3 h-3 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
            <span className="italic">Generating response...</span>
          </div>
        )}
        <SourceLinks pages={sourcePages} />
      </div>
    </div>
  );
}

interface ChatInterfaceProps {
  conversationId: string | null;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string; parts?: string }>;
  serverStreamingText?: string;
}

export function ChatInterface({
  conversationId,
  initialMessages,
  serverStreamingText,
}: ChatInterfaceProps) {
  const createConversation = useMutation(api.conversations.create);
  const saveMessages = useMutation(api.conversations.saveMessages);

  const convIdRef = useRef<Id<"conversations"> | null>(
    conversationId as Id<"conversations"> | null
  );
  const lastSavedIndex = useRef(initialMessages?.length ?? 0);

  const uiInitialMessages = initialMessages
    ? storedToUIMessages(initialMessages)
    : undefined;

  const { messages, sendMessage, status, stop } = useChat({
    messages: uiInitialMessages,
  });
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "streaming" || status === "submitted";

  // Detect when the server is streaming for this conversation
  const lastMsgIsUser =
    messages.length > 0 && messages[messages.length - 1]?.role === "user";
  const serverIsStreaming =
    !isLoading && lastMsgIsUser && serverStreamingText !== undefined;
  const serverHasText = serverIsStreaming && serverStreamingText !== "";
  // Show bounce dots when waiting for server to start producing text
  const serverIsWaiting = serverIsStreaming && serverStreamingText === "";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, serverStreamingText]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-resume: if last message is user with no server stream active,
  // re-submit to get a response
  const hasResumed = useRef(false);
  useEffect(() => {
    if (hasResumed.current) return;
    if (!conversationId) return;
    if (!lastMsgIsUser) return;
    if (isLoading) return;
    if (serverStreamingText !== undefined) return; // server already streaming

    hasResumed.current = true;
    // Fire a background request — server will save via onFinish,
    // client sees progress via reactive streamingText
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.parts,
        })),
        conversationId,
      }),
    }).catch(() => {});
  }, [conversationId, lastMsgIsUser, isLoading, serverStreamingText, messages]);

  // Track saved index — server saves assistant messages via onFinish
  useEffect(() => {
    if (status === "ready" && messages.length > lastSavedIndex.current) {
      lastSavedIndex.current = messages.length;
    }
  }, [status, messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isLoading) return;

      // Create conversation on first message
      if (!convIdRef.current) {
        const title = text.slice(0, 60) + (text.length > 60 ? "..." : "");
        const id = await createConversation({ title });
        convIdRef.current = id;
        lastSavedIndex.current = 0;
        window.history.replaceState(null, "", `/chat/${id}`);
      }

      // Save user message eagerly so it's available if page remounts
      saveMessages({
        conversationId: convIdRef.current,
        messages: [{ role: "user" as const, content: text, createdAt: Date.now() }],
      });

      sendMessage(
        { text },
        { body: { conversationId: convIdRef.current } }
      );
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    },
    [input, isLoading, createConversation, sendMessage]
  );

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4"
      >
        {messages.length === 0 && (
          <div className="text-center py-16 text-[var(--text-muted)]">
            <h1 className="text-lg font-semibold text-[var(--foreground)] mb-1">
              Research Assistant
            </h1>
            <p className="text-xs mb-6">
              Ask questions about Diana&apos;s diagnosis, treatment, and
              research
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md mx-auto">
              {[
                "What is Diana's treatment plan?",
                "Explain ctDNA monitoring options",
                "What clinical trials are relevant?",
                "Summarize the prognosis",
              ].map((q) => (
                <button
                  key={q}
                  onClick={async () => {
                    if (!convIdRef.current) {
                      const title =
                        q.slice(0, 60) + (q.length > 60 ? "..." : "");
                      const id = await createConversation({ title });
                      convIdRef.current = id;
                      lastSavedIndex.current = 0;
                      window.history.replaceState(null, "", `/chat/${id}`);
                    }
                    saveMessages({
                      conversationId: convIdRef.current!,
                      messages: [{ role: "user" as const, content: q, createdAt: Date.now() }],
                    });
                    sendMessage(
                      { text: q },
                      { body: { conversationId: convIdRef.current } }
                    );
                  }}
                  className="text-xs px-3 py-1.5 rounded-full border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          if (message.role === "user") {
            const text = getTextContent(message);
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 bg-[var(--brand)] text-white text-sm whitespace-pre-wrap">
                  {text}
                </div>
              </div>
            );
          }

          const isLastMsg = message.id === messages[messages.length - 1]?.id;
          return <AssistantMessage key={message.id} message={message} isLive={isLastMsg && isLoading} />;
        })}

        {/* Server stream with text — show partial response with streaming cursor */}
        {serverHasText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-[var(--accent-light)] text-[var(--foreground)] text-sm">
              <div className="prose text-sm">
                <MarkdownRenderer content={serverStreamingText!} />
              </div>
              <span className="inline-block w-1.5 h-4 bg-[var(--brand)] animate-pulse ml-0.5 -mb-0.5 rounded-sm" />
            </div>
          </div>
        )}

        {/* Waiting states: client streaming or server waiting for first text */}
        {((isLoading && (messages.length === 0 || lastMsgIsUser)) ||
          serverIsWaiting) && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md px-4 py-2.5 bg-[var(--accent-light)]">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce [animation-delay:0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce [animation-delay:0.3s]" />
                </div>
              </div>
            </div>
          )}

        {/* Bottom actions — after last assistant response */}
        {!isLoading && (
          <ChatBottomActions
            conversationId={convIdRef.current}
            messages={messages}
          />
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-4 py-3">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Ask a question..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-[var(--sidebar-border)] bg-[var(--background)] px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--brand)] transition-colors placeholder:text-[var(--text-muted)]"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 120) + "px";
            }}
          />
          {isLoading ? (
            <button
              type="button"
              onClick={() => stop()}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-[var(--secondary)] text-[var(--foreground)] text-sm font-medium hover:opacity-80 transition-opacity"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-[var(--brand)] text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

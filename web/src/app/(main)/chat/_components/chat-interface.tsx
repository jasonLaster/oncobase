"use client";

import type { UIMessage } from "ai";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownRendererClient as MarkdownRenderer } from "@/components/markdown-renderer-client";
import { GrowingTextarea } from "@/components/growing-textarea";

interface StoredMessage {
  _id?: string;
  role: "user" | "assistant";
  content: string;
  parts?: string;
  disabled?: boolean;
}

// Extended UIMessage with our metadata
interface ChatUIMessage extends UIMessage {
  dbId?: string;
  disabled?: boolean;
}

function storedToUIMessages(msgs: StoredMessage[]): ChatUIMessage[] {
  const cleaned = msgs.filter((m) => m.role === "user" || m.content || m.parts);
  return cleaned.map((m, i) => ({
    id: m._id || `stored-${i}`,
    role: m.role,
    parts: m.parts
      ? (JSON.parse(m.parts) as UIMessage["parts"])
      : [{ type: "text" as const, text: m.content }],
    dbId: m._id,
    disabled: m.disabled,
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

function ReadPageBadge({ input, output, done }: { input: Record<string, unknown>; output: unknown; done: boolean }) {
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
}

function SearchResultsBlock({ output, done, query }: { output: unknown; done: boolean; query: string }) {
  const [expanded, setExpanded] = useState(false);
  const results = (Array.isArray(output) ? output : []) as Array<{ slug?: string; title?: string }>;

  // Hide empty-query searches (model sometimes probes with empty string)
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
            ? (query ? `Searching "${query}"...` : "Searching...")
            : `Searched "${query}" — ${results.length} result${results.length !== 1 ? "s" : ""}`}
        </span>
        {done && results.length > 0 && (
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className={`shrink-0 opacity-30 transition-transform ${expanded ? "rotate-90" : ""}`}>
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
}

function ToolCallBlock({ toolName, state, output, input }: { toolName: string; state: string; output?: unknown; input?: unknown }) {
  const done = state === "output-available" || state === "output-error";
  const inputObj = (input || {}) as Record<string, unknown>;

  if (toolName === "read_page") {
    return <ReadPageBadge input={inputObj} output={output} done={done} />;
  }
  if (toolName === "search_wiki") {
    return <SearchResultsBlock output={output} done={done} query={(inputObj.query as string) || ""} />;
  }
  // Generic fallback
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
}

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

function extractSourcePages(parts: UIMessage["parts"]) {
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

function SourceLinks({ pages }: { pages: Array<{ slug: string; title: string }> }) {
  if (pages.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-[var(--sidebar-border)]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Sources</div>
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
}

/** Group consecutive text parts and consecutive tool parts for compact rendering. */
type PartGroup =
  | { kind: "text"; texts: string[] }
  | { kind: "tools"; parts: Array<{ type: string; [k: string]: unknown }> }
  | { kind: "other"; part: { type: string; [k: string]: unknown } };

function groupParts(parts: Array<{ type: string; [k: string]: unknown }>): PartGroup[] {
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

function AssistantMessage({ message }: { message: UIMessage }) {
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
          return (
            <div key={i} className="prose text-sm max-w-none">
              <MarkdownRenderer disableAnchors content={group.texts.join("\n\n")} />
            </div>
          );
        }
        if (group.kind === "tools") {
          return (
            <div key={i} className="space-y-1 py-1">
              {group.parts.map((part, j) => {
                const info = getToolInfo(part as Record<string, unknown>);
                if (!info) return null;
                return <ToolCallBlock key={j} toolName={info.toolName} state={info.state} output={info.output} input={info.input} />;
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

interface ChatInterfaceProps {
  conversationId: string | null;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string; parts?: string }>;
}

export function ChatInterface({
  conversationId: initialConversationId,
  initialMessages,
}: ChatInterfaceProps) {
  const createConversation = useMutation(api.conversations.create);
  const sendMessageMutation = useMutation(api.conversations.sendMessage);

  const convIdRef = useRef<Id<"conversations"> | null>(
    initialConversationId as Id<"conversations"> | null
  );
  // Track conversation ID in state so useQuery re-subscribes when it changes
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConversationId);

  // Subscribe to conversation for reactive streamingText + messages
  // TODO: split into getStreamingState query once convex dev syncs the new function
  const conversation = useQuery(
    api.conversations.get,
    activeConvId ? { id: activeConvId as Id<"conversations"> } : "skip"
  );
  const clearStreamingMutation = useMutation(api.conversations.clearStreaming);
  const disableMessageMutation = useMutation(api.conversations.disableMessage);
  const serverStreamingText = conversation?.streamingText;
  const serverStreamingParts = conversation?.streamingParts;
  const streamingUpdatedAt = conversation?.streamingUpdatedAt;

  const [messages, setMessages] = useState<ChatUIMessage[]>(() =>
    initialMessages ? storedToUIMessages(initialMessages) : []
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Disable the last user message and mark it visually
  const disableLastUserMessage = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1] as ChatUIMessage;
      if (last?.role === "user" && last.dbId) {
        disableMessageMutation({ id: last.dbId as Id<"messages"> });
        return prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, disabled: true } as ChatUIMessage : m
        );
      }
      return prev;
    });
  }, [disableMessageMutation]);

  // Detect and clear stale streams (no update in 30s)
  useEffect(() => {
    if (serverStreamingText === undefined || !streamingUpdatedAt || !activeConvId) return;
    const age = Date.now() - streamingUpdatedAt;

    function handleStale() {
      clearStreamingMutation({ conversationId: activeConvId as Id<"conversations"> });
      disableLastUserMessage();
    }

    if (age > 30_000) {
      handleStale();
      return;
    }
    const timer = setTimeout(handleStale, 30_000 - age);
    return () => clearTimeout(timer);
  }, [serverStreamingText, streamingUpdatedAt, activeConvId, clearStreamingMutation, disableLastUserMessage]);

  const lastMsgIsUser =
    messages.length > 0 && messages[messages.length - 1]?.role === "user";
  const isGenerating = serverStreamingText !== undefined;
  const serverHasText = isGenerating && serverStreamingText !== "";
  const serverIsWaiting = isGenerating && serverStreamingText === "";
  const isBusy = sending || isGenerating;

  // Memoize parsed streaming parts — avoid JSON.parse in the render path
  const parsedStreamingParts = useMemo(() => {
    if (!serverStreamingParts) return null;
    try { return JSON.parse(serverStreamingParts) as Array<{ type: string; [k: string]: unknown }>; }
    catch { return null; }
  }, [serverStreamingParts]);

  const streamingGroups = useMemo(
    () => parsedStreamingParts ? groupParts(parsedStreamingParts) : null,
    [parsedStreamingParts]
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track whether user has scrolled up
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      if (!el) return;
      const threshold = 100;
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      isNearBottomRef.current = near;
      setShowScrollButton(!near);
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll: instant pin during streaming (no animation overhead), smooth for final messages
  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    if (isGenerating) {
      if (process.env.NODE_ENV === "development") {
        const t = performance.now();
        el.scrollTop = el.scrollHeight;
        const dt = performance.now() - t;
        if (dt > 5) console.warn(`[chat-scroll] layout: ${dt.toFixed(1)}ms`);
      } else {
        el.scrollTop = el.scrollHeight;
      }
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, serverStreamingText, isGenerating]);

  // Perf: warn on slow renders during streaming (dev only)
  useEffect(() => {
    if (process.env.NODE_ENV !== "development" || !isGenerating) return;
    const t0 = performance.now();
    requestAnimationFrame(() => {
      const dt = performance.now() - t0;
      if (dt > 32) {
        console.warn(`[chat-stream] slow render: ${dt.toFixed(1)}ms`, {
          parts: parsedStreamingParts?.length ?? 0,
          textLen: serverStreamingText?.length ?? 0,
        });
      }
    });
  });

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sync messages from Convex when generation completes
  // (streamingText goes from defined to undefined = new message saved)
  const prevStreamingRef = useRef(serverStreamingText);
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current !== undefined;
    const nowDone = serverStreamingText === undefined;
    if (process.env.NODE_ENV === "development") {
      if (wasStreaming && !nowDone) {
        console.log("[chat-client] streaming update", { textLen: serverStreamingText?.length });
      }
      if (wasStreaming && nowDone) {
        console.log("[chat-client] streaming ended — syncing messages");
      }
      if (!wasStreaming && !nowDone) {
        console.log("[chat-client] streaming started");
      }
    }
    prevStreamingRef.current = serverStreamingText;

    if (wasStreaming && nowDone && conversation?.messages) {
      const next = storedToUIMessages(
        conversation.messages.map((m) => ({
          _id: m._id,
          role: m.role,
          content: m.content,
          parts: m.parts,
          disabled: m.disabled,
        }))
      );
      queueMicrotask(() => setMessages(next));
    }
  }, [serverStreamingText, conversation]);

  // Generation trigger with abort support
  const abortRef = useRef<AbortController | null>(null);

  function triggerGeneration(convId: string, msgs: Array<{ id: string; role: string; parts: unknown[] }>) {
    hasResumed.current = true; // prevent auto-resume from double-firing
    setError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: msgs,
        conversationId: convId,
      }),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg = data?.error || `Chat failed (${res.status})`;
        setError(msg);
        clearStreamingMutation({ conversationId: convId as Id<"conversations"> });
        disableLastUserMessage();
      }
    }).catch((err) => {
      if (err?.name !== "AbortError") {
        setError("Failed to connect to chat API.");
        clearStreamingMutation({ conversationId: convId as Id<"conversations"> });
        disableLastUserMessage();
      }
    });
  }

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (activeConvId) {
      clearStreamingMutation({ conversationId: activeConvId as Id<"conversations"> });
      disableLastUserMessage();
    }
  }, [activeConvId, clearStreamingMutation, disableLastUserMessage]);

  // Auto-resume: if last message is user (not disabled) with no active stream, re-trigger
  const lastMsg = messages[messages.length - 1] as ChatUIMessage | undefined;
  const lastMsgIsActiveUser = lastMsgIsUser && !lastMsg?.disabled;

  const hasResumed = useRef(false);
  useEffect(() => {
    if (hasResumed.current) return;
    if (!activeConvId) return;
    if (!lastMsgIsActiveUser) return;
    if (serverStreamingText !== undefined) return; // already streaming

    hasResumed.current = true;
    // Only include non-disabled messages in the generation request
    const activeMessages = messages.filter((m) => !(m as ChatUIMessage).disabled);
    triggerGeneration(
      activeConvId,
      activeMessages.map((m) => ({ id: m.id, role: m.role, parts: m.parts as unknown[] }))
    );
  }, [activeConvId, lastMsgIsActiveUser, serverStreamingText, messages]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isBusy) return;

      setSending(true);

      // Create conversation on first message
      if (!convIdRef.current) {
        const title = text.slice(0, 60) + (text.length > 60 ? "..." : "");
        const id = await createConversation({ title });
        convIdRef.current = id;
        setActiveConvId(id);
        window.history.replaceState(null, "", `/chat/${id}`);
      }

      // Add user message to local state immediately
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: "user" as const,
          parts: [{ type: "text" as const, text }],
        },
      ]);

      // Save user message via Convex mutation (also sets streamingText="")
      await sendMessageMutation({
        conversationId: convIdRef.current,
        text,
      });

      // Fire-and-forget: trigger generation via the Next.js API route
      // The route writes streamingText + final message to Convex
      const activeMessages = messages.filter((m) => !(m as ChatUIMessage).disabled);
      triggerGeneration(convIdRef.current, [
        ...activeMessages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.parts,
        })),
        {
          id: `local-${Date.now()}`,
          role: "user" as const,
          parts: [{ type: "text" as const, text }],
        },
      ]);

      setSending(false);
      setInput("");
      isNearBottomRef.current = true; // force scroll on new message
    },
    [input, isBusy, createConversation, sendMessageMutation, messages]
  );

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full relative">
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-2 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4"
      >
        {messages.length === 0 && !isBusy && (
          <div className="text-center py-10 sm:py-16 text-[var(--text-muted)]">
            <h1 className="text-lg font-semibold text-[var(--foreground)] mb-1">
              Research Assistant
            </h1>
            <p className="text-xs mb-4 sm:mb-6">
              Ask questions about Diana&apos;s diagnosis, treatment, and research
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md mx-auto px-2">
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
                      const title = q.slice(0, 60) + (q.length > 60 ? "..." : "");
                      const id = await createConversation({ title });
                      convIdRef.current = id;
                      setActiveConvId(id);
                      window.history.replaceState(null, "", `/chat/${id}`);
                    }
                    const userMsg = {
                      id: `local-${Date.now()}`,
                      role: "user" as const,
                      parts: [{ type: "text" as const, text: q }],
                    };
                    setMessages([userMsg]);
                    await sendMessageMutation({
                      conversationId: convIdRef.current!,
                      text: q,
                    });
                    triggerGeneration(convIdRef.current!, [userMsg]);
                  }}
                  className="text-xs sm:text-sm px-3 py-2 sm:py-1.5 rounded-full border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] active:bg-[var(--accent-light)] transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, idx) => {
          const chatMsg = message as ChatUIMessage;
          if (message.role === "user") {
            const text = message.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("");
            return (
              <div key={message.id} className={`group/msg border-t border-[var(--sidebar-border)] pt-4 ${chatMsg.disabled ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-2">
                  <div className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap flex-1 ${
                    chatMsg.disabled
                      ? "bg-[var(--sidebar-border)] text-[var(--text-muted)] line-through"
                      : "bg-[var(--accent-light)] text-[var(--brand)]"
                  }`}>
                    {text}
                  </div>
                  <button
                    onClick={() => {
                      setInput(text);
                      setMessages((prev) => prev.slice(0, idx));
                    }}
                    title="Edit message"
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
          return <AssistantMessage key={message.id} message={message} />;
        })}

        {/* Server stream with structured parts — hide if last message is already assistant (final synced) */}
        {(serverHasText || serverStreamingParts) && !(messages.length > 0 && messages[messages.length - 1]?.role === "assistant") && (
          <div className="text-sm space-y-3">
            {streamingGroups ? (
              streamingGroups.map((group, i) => {
                if (group.kind === "text") {
                  return (
                    <div key={i} className="prose text-sm max-w-none">
                      <MarkdownRenderer disableAnchors content={group.texts.join("\n\n")} />
                    </div>
                  );
                }
                if (group.kind === "tools") {
                  return (
                    <div key={i} className="space-y-1 py-1">
                      {group.parts.map((part, j) => {
                        const info = getToolInfo(part as Record<string, unknown>);
                        if (!info) return null;
                        return <ToolCallBlock key={j} toolName={info.toolName} state={info.state} output={info.output} input={info.input} />;
                      })}
                    </div>
                  );
                }
                return null;
              })
            ) : serverStreamingText ? (
              <div className="prose text-sm max-w-none">
                <MarkdownRenderer disableAnchors content={serverStreamingText} />
              </div>
            ) : null}
            {isGenerating && (
              <div className="flex items-center gap-1.5 pt-1">
                <span className="inline-block w-1.5 h-4 bg-[var(--brand)] animate-pulse rounded-sm" />
                <span className="text-xs text-[var(--text-muted)] animate-pulse">Generating...</span>
              </div>
            )}
          </div>
        )}

        {/* Waiting: server hasn't produced text yet */}
        {!error && (serverIsWaiting || (sending && lastMsgIsUser)) && (
          <div className="flex gap-1 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce [animation-delay:0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce [animation-delay:0.3s]" />
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 mt-0.5">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 4a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V5zm.75 6.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
            </svg>
            <span>{error}</span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom */}
      {showScrollButton && (
        <div className="absolute bottom-20 right-3 sm:right-4 z-10">
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            className="p-2.5 sm:p-2 rounded-full bg-[var(--background)] border border-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--foreground)] shadow-md hover:shadow-lg transition-all active:scale-95"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 6 8 10 12 6" />
            </svg>
          </button>
        </div>
      )}

      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-2 sm:px-4 py-2 sm:py-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-3">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <GrowingTextarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Ask a question..."
            maxHeight={160}
            className="flex-1 resize-none rounded-xl border border-[var(--sidebar-border)] bg-[var(--background)] px-3 sm:px-4 py-2.5 text-base sm:text-sm leading-relaxed focus:outline-none focus:border-[var(--brand)] transition-colors placeholder:text-[var(--text-muted)]"
          />
          {isBusy ? (
            <button
              type="button"
              onClick={handleStop}
              className="shrink-0 px-4 py-2.5 rounded-xl border border-[var(--sidebar-border)] bg-[var(--background)] text-[var(--foreground)] text-sm font-medium hover:bg-[var(--destructive)] hover:text-white hover:border-[var(--destructive)] active:bg-[var(--destructive)] active:text-white transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-[var(--brand)] text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 active:opacity-80 transition-opacity"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

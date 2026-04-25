"use client";

import {
  DefaultChatTransport,
  type UIMessage,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { GrowingTextarea } from "@/components/growing-textarea";
import { nowMs, recordChatPerf, trackStream } from "@/lib/chat/perf";
import {
  StickToBottom,
  useStickToBottomContext,
} from "use-stick-to-bottom";
import {
  AssistantMessage,
  PriorMessages,
  StreamingMessage,
  type ChatUIMessage as ChatUIMessageFromMessages,
} from "./messages";

interface StoredMessage {
  _id?: string;
  role: "user" | "assistant";
  content: string;
  // Phase 2: parts is union(string, array). Old rows are JSON-encoded strings
  // until the migration runs; new rows are native arrays.
  parts?: string | unknown[];
  disabled?: boolean;
}

// Extended UIMessage with our metadata. Re-exported from messages.tsx so
// the split components share the type.
type ChatUIMessage = ChatUIMessageFromMessages;

function readParts(parts: string | unknown[] | undefined): UIMessage["parts"] | null {
  if (parts === undefined) return null;
  if (Array.isArray(parts)) return parts as UIMessage["parts"];
  if (typeof parts === "string" && parts.length > 0) {
    try {
      return JSON.parse(parts) as UIMessage["parts"];
    } catch {
      return null;
    }
  }
  return null;
}

function storedToUIMessages(msgs: StoredMessage[]): ChatUIMessage[] {
  const cleaned = msgs.filter((m) => m.role === "user" || m.content || m.parts);
  return cleaned.map((m, i) => ({
    id: m._id || `stored-${i}`,
    role: m.role,
    parts:
      readParts(m.parts) ?? [{ type: "text" as const, text: m.content }],
    dbId: m._id,
    disabled: m.disabled,
  }));
}

// Per-part renderers and AssistantMessage live in ./messages.tsx so they can
// be memoized independently. The CrossTabStream component below uses the same
// helpers via groupParts() + the shared tool block.

/**
 * The Convex mirror's streaming row, rendered when *another* tab is driving
 * the stream. Reuses AssistantMessage to keep the rendering identical to
 * post-completion messages — no separate branch.
 */
function CrossTabStream({
  text,
  parts,
}: {
  text: string;
  parts: UIMessage["parts"] | null;
}) {
  const synthetic: UIMessage = useMemo(
    () => ({
      id: "cross-tab-stream",
      role: "assistant",
      parts: parts ?? [{ type: "text", text }],
    }),
    [text, parts]
  );
  return <AssistantMessage message={synthetic} />;
}

/**
 * Floating "scroll to bottom" pill. Pulls live state from the
 * <StickToBottom> wrapping it; only renders when the user has scrolled away
 * from the bottom (i.e., escaped from the auto-pin lock).
 */
function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <div className="absolute bottom-3 right-3 sm:right-4 z-10">
      <button
        type="button"
        onClick={() => scrollToBottom()}
        aria-label="Scroll to bottom"
        className="p-2.5 sm:p-2 rounded-full bg-[var(--background)] border border-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--foreground)] shadow-md hover:shadow-lg transition-all active:scale-95"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 6 8 10 12 6" />
        </svg>
      </button>
    </div>
  );
}

interface ChatInterfaceProps {
  conversationId: string | null;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string; parts?: string | unknown[] }>;
}

export function ChatInterface({
  conversationId: initialConversationId,
  initialMessages,
}: ChatInterfaceProps) {
  const createConversation = useMutation(api.conversations.create);
  const sendMessageMutation = useMutation(api.conversations.sendMessage);
  const clearStreamingMutation = useMutation(api.conversations.clearStreaming);
  const disableMessageMutation = useMutation(api.conversations.disableMessage);

  // The Convex conversation id. Null until the first message is sent.
  const [activeConvId, setActiveConvId] = useState<string | null>(
    initialConversationId
  );
  const convIdRef = useRef<string | null>(activeConvId);
  useEffect(() => {
    convIdRef.current = activeConvId;
  }, [activeConvId]);

  // Convex subscription (cross-tab + history).
  const conversation = useQuery(
    api.conversations.get,
    activeConvId ? { id: activeConvId as Id<"conversations"> } : "skip"
  );
  const serverStreamingText = conversation?.streamingText;
  const serverStreamingParts = conversation?.streamingParts;
  const streamingUpdatedAt = conversation?.streamingUpdatedAt;

  // Initial messages — captured once on mount; useChat owns the running list.
  const initialUIMessages = useMemo(
    () => (initialMessages ? storedToUIMessages(initialMessages) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // SSE transport — adds conversationId to the request body so the route
  // can write its Convex mirror.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...(body ?? {}),
            messages,
            conversationId: convIdRef.current,
          },
        }),
      }),
    []
  );

  // Track perf for the active stream. trackStream hooks fire from
  // sendMessage / regenerate / stop.
  const trackerRef = useRef<ReturnType<typeof trackStream> | null>(null);
  function startTracker() {
    const submitT = nowMs();
    recordChatPerf({ type: "submit", t: submitT, conversationId: convIdRef.current });
    trackerRef.current = trackStream({
      conversationId: convIdRef.current,
      submitT,
    });
  }
  function endTracker(reason: "ok" | "abort" | "error") {
    trackerRef.current?.end(reason);
    trackerRef.current = null;
  }

  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    clearError,
  } = useChat<ChatUIMessage>({
    messages: initialUIMessages,
    transport,
    experimental_throttle: 50,
    onFinish: () => {
      endTracker("ok");
    },
    onError: () => {
      endTracker("error");
    },
  });

  // useChat does not expose first-byte timing; approximate by recording the
  // first message-id we observe after submit. Phase 0 instrumentation runs
  // through trackerRef so the perf buffer still gets samples.
  useEffect(() => {
    if (status === "streaming" && trackerRef.current) {
      // Touch the tracker so the first-token event fires.
      trackerRef.current.tick(0);
    }
  }, [status]);

  const [input, setInput] = useState("");

  const lastMessage = messages[messages.length - 1] as ChatUIMessage | undefined;
  const lastIsActiveUser =
    lastMessage?.role === "user" && !lastMessage.disabled;
  const isStreaming = status === "submitted" || status === "streaming";

  // Cross-tab streaming visibility: render the Convex mirror only when this
  // tab is not driving the stream and the mirror is non-empty.
  const showCrossTabStream =
    !isStreaming &&
    serverStreamingText !== undefined &&
    (serverStreamingText.length > 0 ||
      (Array.isArray(serverStreamingParts) && serverStreamingParts.length > 0));

  const parsedCrossTabParts = useMemo(() => {
    if (!serverStreamingParts) return null;
    if (Array.isArray(serverStreamingParts)) {
      return serverStreamingParts as Array<{ type: string; [k: string]: unknown }>;
    }
    if (typeof serverStreamingParts === "string") {
      try {
        return JSON.parse(serverStreamingParts) as Array<{
          type: string;
          [k: string]: unknown;
        }>;
      } catch {
        return null;
      }
    }
    return null;
  }, [serverStreamingParts]);

  // Sync from Convex when the local list is behind (e.g., another tab's
  // stream completed and saved messages).
  useEffect(() => {
    if (status !== "ready") return;
    if (!conversation?.messages) return;
    if (conversation.messages.length <= messages.length) return;
    const next = storedToUIMessages(
      conversation.messages.map((m) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        parts: m.parts,
        disabled: m.disabled,
      }))
    );
    setMessages(next);
  }, [status, conversation, messages.length, setMessages]);

  // 30s stale-stream watchdog — clears the Convex mirror if the server died.
  const disableLastUserMessage = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1] as ChatUIMessage;
      if (last?.role === "user" && last.dbId) {
        disableMessageMutation({ id: last.dbId as Id<"messages"> });
        return prev.map((m, i) =>
          i === prev.length - 1 ? ({ ...m, disabled: true } as ChatUIMessage) : m
        );
      }
      return prev;
    });
  }, [disableMessageMutation, setMessages]);

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
  }, [
    serverStreamingText,
    streamingUpdatedAt,
    activeConvId,
    clearStreamingMutation,
    disableLastUserMessage,
  ]);

  // Scroll pin is owned by <StickToBottom> below + the floating
  // <ScrollToBottomButton>. The hook handles "user scrolled up → release pin
  // → show pill", which we used to do by hand. autoFocus on the textarea
  // gives us focus on mount.

  // Auto-resume: if the trailing user message has no assistant follow-up
  // and no other tab is streaming, kick off a generation. Debounced via
  // sessionStorage on (conversationId, lastUserMessageId) so a fast double
  // mount in dev does not fire twice.
  const autoResumed = useRef(false);
  useEffect(() => {
    if (autoResumed.current) return;
    if (!activeConvId) return;
    if (status !== "ready") return;
    if (!lastIsActiveUser) return;
    if (serverStreamingText !== undefined) return;
    const lastUserId = lastMessage?.id;
    if (!lastUserId) return;
    const key = `chat:auto-resume:${activeConvId}:${lastUserId}`;
    if (typeof sessionStorage !== "undefined") {
      try {
        if (sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key, "1");
      } catch {
        // sessionStorage may be unavailable (cookies disabled, private mode);
        // fall through to the in-memory ref guard.
      }
    }
    autoResumed.current = true;
    startTracker();
    void regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, status, lastIsActiveUser, serverStreamingText, lastMessage]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || isStreaming) return;
      clearError();

      let convId = convIdRef.current;
      if (!convId) {
        const title = text.slice(0, 60) + (text.length > 60 ? "…" : "");
        convId = await createConversation({ title });
        convIdRef.current = convId;
        setActiveConvId(convId);
        window.history.replaceState(null, "", `/chat/${convId}`);
      }

      // Persist the user message so cross-tab subscribers see it and the
      // 30s watchdog has a streamingUpdatedAt to track.
      await sendMessageMutation({
        conversationId: convId as Id<"conversations">,
        text,
      });

      autoResumed.current = true;
      setInput("");
      startTracker();
      await sendMessage({ text });
    },
    [input, isStreaming, clearError, createConversation, sendMessageMutation, sendMessage]
  );

  // Edit-trailing-user-message handler. Stable reference so PriorMessages
  // memo doesn't bust on each render.
  const handleEditUser = useCallback(
    (text: string, msg: ChatUIMessage) => {
      setInput(text);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        return idx >= 0 ? prev.slice(0, idx) : prev;
      });
    },
    [setMessages]
  );

  // Split messages into the memoized prior list + the live streaming tail.
  // The tail is the last assistant message *while streaming*; otherwise all
  // messages are "prior" (no separate tail render).
  const { priorMessages, streamingTail } = useMemo(() => {
    if (
      isStreaming &&
      lastMessage?.role === "assistant"
    ) {
      return {
        priorMessages: messages.slice(0, -1) as ChatUIMessage[],
        streamingTail: lastMessage,
      };
    }
    return {
      priorMessages: messages as ChatUIMessage[],
      streamingTail: null as ChatUIMessage | null,
    };
  }, [messages, isStreaming, lastMessage]);

  const handleStop = useCallback(() => {
    stop();
    endTracker("abort");
    if (activeConvId) {
      clearStreamingMutation({ conversationId: activeConvId as Id<"conversations"> });
      disableLastUserMessage();
    }
  }, [stop, activeConvId, clearStreamingMutation, disableLastUserMessage]);

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full relative">
      <StickToBottom
        className="flex-1 min-h-0"
        resize="smooth"
        initial="instant"
      >
        <StickToBottom.Content
          className="px-2 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4"
          role="log"
          aria-live="polite"
        >
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-10 sm:py-16 text-[var(--text-muted)]">
            <h1 className="text-lg font-semibold text-[var(--foreground)] mb-1">
              Research Assistant
            </h1>
            <p className="text-xs mb-4 sm:mb-6">
              Ask questions about the diagnosis, treatment, and research
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md mx-auto px-2">
              {[
                "What is the treatment plan?",
                "Explain ctDNA monitoring options",
                "What clinical trials are relevant?",
                "Summarize the prognosis",
              ].map((q) => (
                <button
                  key={q}
                  onClick={async () => {
                    let convId = convIdRef.current;
                    if (!convId) {
                      const title = q.slice(0, 60) + (q.length > 60 ? "..." : "");
                      convId = await createConversation({ title });
                      convIdRef.current = convId;
                      setActiveConvId(convId);
                      window.history.replaceState(null, "", `/chat/${convId}`);
                    }
                    await sendMessageMutation({
                      conversationId: convId as Id<"conversations">,
                      text: q,
                    });
                    autoResumed.current = true;
                    startTracker();
                    void sendMessage({ text: q });
                  }}
                  className="text-xs sm:text-sm px-3 py-2 sm:py-1.5 rounded-full border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] active:bg-[var(--accent-light)] transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Memoized list. Re-renders only when length or trailing id change. */}
        <PriorMessages
          messages={priorMessages}
          onEditUser={handleEditUser}
        />

        {/* The streaming tail — only this re-renders per token tick. */}
        {streamingTail && <StreamingMessage message={streamingTail} />}

        {/* Cross-tab visibility: another tab is driving a stream. */}
        {showCrossTabStream && (
          <CrossTabStream
            text={serverStreamingText ?? ""}
            parts={parsedCrossTabParts as UIMessage["parts"] | null}
          />
        )}

        {/* Submit pending — model has not started streaming yet. */}
        {isStreaming &&
          (!lastMessage || lastMessage.role === "user") && (
            <div
              className="flex gap-1 py-2 motion-reduce:animate-none"
              role="status"
              aria-label="Generating response"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce motion-reduce:animate-none" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce motion-reduce:animate-none [animation-delay:0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce motion-reduce:animate-none [animation-delay:0.3s]" />
            </div>
          )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 mt-0.5">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 4a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V5zm.75 6.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
            </svg>
            <span>{error.message}</span>
          </div>
        )}
        </StickToBottom.Content>
        <ScrollToBottomButton />
      </StickToBottom>

      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-2 sm:px-4 py-2 sm:py-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-3">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <GrowingTextarea
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // IME-safe Enter: keyCode 229 / isComposing means an IME is
              // mid-composition; Enter then commits the candidate, not the
              // form. Without this, Japanese / Chinese / Korean composition
              // submits the partial.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Ask a question..."
            maxHeight={160}
            className="flex-1 resize-none rounded-xl border border-[var(--sidebar-border)] bg-[var(--background)] px-3 sm:px-4 py-2.5 text-base sm:text-sm leading-relaxed focus:outline-none focus:border-[var(--brand)] transition-colors placeholder:text-[var(--text-muted)]"
          />
          {isStreaming ? (
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

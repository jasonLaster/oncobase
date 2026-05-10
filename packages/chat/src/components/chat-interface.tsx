"use client";

import {
  DefaultChatTransport,
  type UIMessage,
} from "ai";
import { useChat } from "@ai-sdk/react";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { nowMs, recordChatPerf, trackStream } from "../perf";
import { useChatRuntime } from "../runtime";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "./ai-elements/conversation";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputSubmit,
  PromptInputFooter,
  type PromptInputMessage,
} from "./ai-elements/prompt-input";
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
  return <AssistantMessage message={synthetic} isStreaming testId="chat-cross-tab-message" />;
}

interface ChatInterfaceProps {
  conversationId: string | null;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string; parts?: string | unknown[] }>;
}

export function ChatInterface({
  conversationId: initialConversationId,
  initialMessages,
}: ChatInterfaceProps) {
  const { apiPath, convexApi, copy, routes, siteSlug, storageKeyPrefix } = useChatRuntime();
  const siteArgs = useMemo(() => (siteSlug ? { siteSlug } : {}), [siteSlug]);
  const createConversation = useMutation(convexApi.conversations.create);
  const sendMessageMutation = useMutation(convexApi.conversations.sendMessage);
  const clearStreamingMutation = useMutation(convexApi.conversations.clearStreaming);
  const cancelStreamMutation = useMutation(convexApi.conversations.cancelStream);
  const disableMessageMutation = useMutation(convexApi.conversations.disableMessage);

  // The Convex conversation id. Null until the first message is sent.
  const [activeConvId, setActiveConvId] = useState<string | null>(
    initialConversationId
  );
  const convIdRef = useRef<string | null>(activeConvId);
  useEffect(() => {
    convIdRef.current = activeConvId;
  }, [activeConvId]);

  const resetTokenRef = useRef(0);
  const [resetToken, setResetToken] = useState(0);
  useEffect(() => {
    function onNewChat() {
      setActiveConvId(null);
      resetTokenRef.current += 1;
      setResetToken(resetTokenRef.current);
    }
    window.addEventListener("chat:new", onNewChat);
    return () => window.removeEventListener("chat:new", onNewChat);
  }, []);

  // PR 28 review — Data Subscriptions: split message history from streaming
  // state. The streaming-state hot path (4Hz writes during a turn) must NOT
  // invalidate the message-history query. Two queries:
  //   - getStreamingState reads only `conversations.streaming*` and
  //     `activeRunId`. It re-runs on every flush, but it's tiny.
  //   - getMessages reads only the `messages` table (joined by index).
  //     It re-runs only when messages are inserted (saveMessages on
  //     submit + onFinish), not on streaming patches.
  const streamingState = useQuery(
    convexApi.conversations.getStreamingState,
    activeConvId ? { id: activeConvId, ...siteArgs } : "skip"
  );
  const conversationMessages = useQuery(
    convexApi.conversations.getMessages,
    activeConvId ? { id: activeConvId, ...siteArgs } : "skip"
  );
  const serverStreamingText = streamingState?.streamingText;
  const serverStreamingParts = streamingState?.streamingParts;
  const streamingUpdatedAt = streamingState?.streamingUpdatedAt;

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
        api: apiPath,
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...(body ?? {}),
            messages,
            conversationId: convIdRef.current,
          },
        }),
      }),
    [apiPath]
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

  // Composer draft persistence keyed by conversation id. Drafts survive page
  // navigation. Saved on every change, restored on mount.
  const draftKey = `${storageKeyPrefix}:draft:${activeConvId ?? "new"}`;
  const [input, setInput] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return sessionStorage.getItem(draftKey) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (input) sessionStorage.setItem(draftKey, input);
      else sessionStorage.removeItem(draftKey);
    } catch {
      // sessionStorage may be blocked; ignore.
    }
  }, [input, draftKey]);

  useEffect(() => {
    if (resetToken === 0) return;
    stop();
    setMessages([]);
    clearError();
    setInput("");
  }, [resetToken, stop, setMessages, clearError]);

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
    if (!conversationMessages) return;
    if (conversationMessages.length <= messages.length) return;
    const next = storedToUIMessages(
      conversationMessages.map((m: StoredMessage) => ({
        _id: m._id,
        role: m.role,
        content: m.content,
        parts: m.parts,
        disabled: m.disabled,
      }))
    );
    setMessages(next);
  }, [status, conversationMessages, messages.length, setMessages]);

  // 30s stale-stream watchdog — clears the Convex mirror if the server died.
  const disableLastUserMessage = useCallback(() => {
    setMessages((prev) => {
      const last = prev[prev.length - 1] as ChatUIMessage;
      if (last?.role === "user" && last.dbId) {
        disableMessageMutation({ id: last.dbId, ...siteArgs });
        return prev.map((m, i) =>
          i === prev.length - 1 ? ({ ...m, disabled: true } as ChatUIMessage) : m
        );
      }
      return prev;
    });
  }, [disableMessageMutation, setMessages, siteArgs]);

  useEffect(() => {
    if (serverStreamingText === undefined || !streamingUpdatedAt || !activeConvId) return;
    const age = Date.now() - streamingUpdatedAt;
    function handleStale() {
      clearStreamingMutation({ conversationId: activeConvId, ...siteArgs });
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
    siteArgs,
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
    const key = `${storageKeyPrefix}:auto-resume:${activeConvId}:${lastUserId}`;
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

  const submitMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      clearError();

      let convId = convIdRef.current;
      if (!convId) {
        const title = trimmed.slice(0, 60) + (trimmed.length > 60 ? "…" : "");
        const createdConvId = (await createConversation({ title, ...siteArgs })) as string;
        convId = createdConvId;
        convIdRef.current = convId;
        setActiveConvId(convId);
        window.history.replaceState(
          null,
          "",
          routes.conversationPath(createdConvId)
        );
      }

      // Persist the user message so cross-tab subscribers see it and the
      // 30s watchdog has a streamingUpdatedAt to track.
      await sendMessageMutation({
        conversationId: convId,
        text: trimmed,
        ...siteArgs,
      });

      autoResumed.current = true;
      setInput("");
      startTracker();
      await sendMessage({ text: trimmed });
    },
    [
      isStreaming,
    clearError,
    createConversation,
    sendMessageMutation,
    sendMessage,
    routes,
    siteArgs,
  ]
  );

  // <PromptInput> hands us its own message + event shape on submit.
  const handlePromptSubmit = useCallback(
    async (message: PromptInputMessage) => {
      await submitMessage(message.text);
    },
    [submitMessage]
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

  // Regenerate-this-assistant-message handler. Asks useChat to re-run the
  // model from the message *before* the targeted assistant message.
  const handleRegenerate = useCallback(
    (messageId: string) => {
      void regenerate({ messageId }).catch(() => {
        // useChat surfaces the error via its `error` state; no toast here.
      });
    },
    [regenerate]
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
    // Batch A: tell the server to abort via the cancel flag (the route polls
    // it via getCancelState and aborts the model). Don't just clear the
    // streaming row locally — the server-side streamText is no longer tied
    // to the request lifecycle, so without an explicit cancel signal, the
    // model would keep running.
    stop();
    endTracker("abort");
    if (activeConvId) {
      cancelStreamMutation({
        conversationId: activeConvId,
        ...siteArgs,
      });
      // Optimistic UX: clear the local streaming row so the user sees the
      // composer settle. The server's onAbort will save partial text via
      // the flusher.
      clearStreamingMutation({
        conversationId: activeConvId,
        ...siteArgs,
      });
      disableLastUserMessage();
    }
  }, [
    stop,
    activeConvId,
    cancelStreamMutation,
    clearStreamingMutation,
    disableLastUserMessage,
    siteArgs,
  ]);

  // Composer keyboard handler:
  // - Up arrow on empty composer focuses the last user message for edit
  //   (terminal-style history recall).
  // - Esc aborts an active stream.
  // ai-elements <PromptInputTextarea> handles Enter (IME-safe) internally.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleComposerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "ArrowUp" && !e.currentTarget.value && !e.shiftKey) {
        const last = [...messages].reverse().find((m) => m.role === "user");
        if (!last) return;
        const text = last.parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("");
        if (!text) return;
        e.preventDefault();
        handleEditUser(text, last as ChatUIMessage);
      } else if (e.key === "Escape") {
        if (isStreaming) {
          e.preventDefault();
          handleStop();
        }
      }
    },
    [messages, isStreaming, handleEditUser, handleStop]
  );

  // Global keyboard shortcuts:
  // - Cmd/Ctrl+/ focuses the composer from anywhere on the chat page.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const showEmptyState = messages.length === 0 && !isStreaming;

  const renderComposer = (flat = false) => (
    <PromptInput
      onSubmit={handlePromptSubmit}
      data-test-id="chat-composer"
      className={
        flat
          ? "[&_[data-slot=input-group]]:bg-white [&_[data-slot=input-group]]:border-[var(--sidebar-border)] dark:[&_[data-slot=input-group]]:bg-neutral-800 dark:[&_[data-slot=input-group]]:border-neutral-700 [&_[data-slot=input-group]]:shadow-sm [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:ring-0 [&_[data-slot=input-group]]:has-[[data-slot=input-group-control]:focus-visible]:border-[var(--brand)]"
          : undefined
      }
    >
      <PromptInputBody>
        <PromptInputTextarea
          autoFocus
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={copy.promptPlaceholder}
          data-test-id="chat-composer-textarea"
        />
      </PromptInputBody>
      <PromptInputFooter>
        <span className="flex-1" />
        <PromptInputSubmit
          status={status}
          disabled={!isStreaming && !input.trim()}
          onStop={handleStop}
          data-test-id="chat-submit-button"
          className="bg-[var(--brand)] text-white hover:bg-[var(--brand)]/90 disabled:bg-[var(--brand)] disabled:text-white disabled:opacity-100"
        />
      </PromptInputFooter>
    </PromptInput>
  );

  const suggestedPills = copy.suggestedPrompts.length > 0 && (
    <section
      className="w-full flex-1 border-t border-[var(--sidebar-border)]"
      data-test-id="chat-suggested-prompts"
    >
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-12 sm:py-16 flex flex-col gap-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Example questions
        </h3>
        <ul className="flex flex-col divide-y divide-[var(--sidebar-border)]">
          {copy.suggestedPrompts.map((p) => {
            const prompt = typeof p === "string" ? { label: p } : p;
            return (
              <li key={prompt.label}>
                <button
                  type="button"
                  aria-label={prompt.label}
                  onClick={() => void submitMessage(prompt.label)}
                  data-test-id="chat-suggested-prompt"
                  className="w-full flex items-start gap-3 text-left text-sm py-3 cursor-pointer hover:text-[var(--brand)] transition-colors"
                >
                  {prompt.badge && (
                    <span
                      aria-hidden="true"
                      className="shrink-0 text-base leading-6"
                    >
                      {prompt.badge}
                    </span>
                  )}
                  <span>{prompt.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );

  return (
    <div
      className={`flex flex-col h-full w-full relative ${
        showEmptyState ? "" : "max-w-3xl mx-auto"
      }`}
      data-test-id="chat-interface"
      data-chat-status={status}
      data-chat-conversation-id={activeConvId ?? "new"}
    >
      {showEmptyState ? (
        <div
          className="flex-1 min-h-0 flex flex-col w-full overflow-y-auto"
          data-test-id="chat-empty-state"
        >
          <div className="w-full px-4 sm:px-6 pt-16 sm:pt-24 pb-24 sm:pb-32 flex flex-col items-center">
            <div className="w-full max-w-2xl flex flex-col gap-6">
              <div className="space-y-2 text-center">
                <h2 className="font-semibold text-2xl sm:text-3xl tracking-tight text-[var(--foreground)]">
                  {copy.emptyStateTitle}
                </h2>
                {copy.emptyStateDescription && (
                  <p className="text-sm text-[var(--text-muted)]">
                    {copy.emptyStateDescription}
                  </p>
                )}
              </div>
              {renderComposer(true)}
              {error && (
                <div
                  className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm"
                  data-test-id="chat-error"
                  role="alert"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 mt-0.5">
                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 4a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V5zm.75 6.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
                  </svg>
                  <span>{error.message}</span>
                </div>
              )}
            </div>
          </div>
          {suggestedPills}
        </div>
      ) : (
        <>
      <Conversation className="flex-1 min-h-0" data-test-id="chat-message-log">
        <ConversationContent
          className="px-2 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4"
          aria-live="polite"
        >

          {/* Memoized list. Re-renders only when length or trailing id change. */}
          <PriorMessages
            messages={priorMessages}
            onEditUser={handleEditUser}
            onRegenerate={handleRegenerate}
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
                aria-label={copy.generatingLabel}
                data-test-id="chat-stream-pending"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce motion-reduce:animate-none" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce motion-reduce:animate-none [animation-delay:0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce motion-reduce:animate-none [animation-delay:0.3s]" />
              </div>
            )}

          {error && (
            <div
              className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-sm"
              data-test-id="chat-error"
              role="alert"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="shrink-0 mt-0.5">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm-.75 4a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V5zm.75 6.25a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
              </svg>
              <span>{error.message}</span>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 border-t border-[var(--sidebar-border)] px-2 sm:px-4 py-2 sm:py-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:pb-3">
        {renderComposer()}
      </div>
        </>
      )}
    </div>
  );
}

"use client";

import { resolveWebStorage, safeSessionStorage } from "@oncobase/safe-storage";
import { Button } from "@oncobase/ui/button";
import { Field, FieldLabel } from "@oncobase/ui/field";
import { Textarea } from "@oncobase/ui/textarea";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StreamingMarkdown } from "./streaming-markdown";
import type { ChatMarkdownRenderer } from "../types";
import { sessionModelMessages } from "../session-messages";
import { deleteSavedChat, isChatMessages, isSavedChatId, listSavedChats, loadSavedChat, newSavedChatId, saveChat, type SavedChatSummary } from "../saved-chats";
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";

/** What a host's cards can do: ask a question for the reader, optionally with
 * extra request fields for that one message, and fields to send with whatever
 * the reader types next (to answer a question the assistant just asked). */
export type SessionChatActions = {
  ask: (text: string, body?: Record<string, unknown>, withNextMessage?: Record<string, unknown>) => void;
  busy: boolean;
  /** Whether this is the newest message in the conversation. */
  latest: boolean;
};

// The raw store (null when blocked): saveChat needs writes that throw on quota so it can evict old chats.
const local = () => resolveWebStorage("localStorage");
const savedDate = (time: number) => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(time).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });

/** Shared Oncobase streaming UI for public learning sessions without an account.
 * With a `storageKey`, conversations are saved in this browser under a random
 * ID the host can put in its URL. Hosts supply their content cards without
 * pulling in the care/Convex runtime. */
export function SessionChat({ apiPath, body, initialQuestion, storageKey, chatId: requestedChatId, onChatIdChange, title, description, suggestions, renderData, renderText, assistantName = "Assistant", footnote, composerAction, welcomeAction, MarkdownRenderer = StreamingMarkdown }: {
  apiPath: string; body?: Record<string, unknown>; initialQuestion?: string;
  storageKey?: string;
  /** A saved conversation to open, such as one named in the page URL. */
  chatId?: string;
  /** Called with the open conversation's ID once it is saved, and with null for a new chat. */
  onChatIdChange?: (chatId: string | null) => void;
  title: string; description: string; suggestions: string[];
  renderData?: (message: UIMessage, actions: SessionChatActions) => ReactNode;
  /** Renders one piece of an assistant's text, for hosts that place their own content inside it. */
  renderText?: (message: UIMessage, text: string, isStreaming: boolean, actions: SessionChatActions) => ReactNode;
  MarkdownRenderer?: ChatMarkdownRenderer;
  assistantName?: string; footnote?: string;
  /** An extra control beside the send button, such as starting a voice call. */
  composerAction?: ReactNode;
  /** A larger invitation shown with the starter questions before the first message. */
  welcomeAction?: ReactNode;
}) {
  const transport = useMemo(() => new DefaultChatTransport({ api: apiPath, credentials: "omit", body,
    prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: sessionModelMessages(messages) } }),
  }), [apiPath, body]);
  const { messages, sendMessage, regenerate, stop, status, error, clearError, setMessages } = useChat({ transport });
  const [input, setInput] = useState("");
  const started = useRef(false);
  const restored = useRef(false);
  const latestMessages = useRef(messages);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";
  let errorMessage = "The reply couldn’t finish. Please try again.";
  if (error) {
    try {
      const response = JSON.parse(error.message);
      if (typeof response.error === "string") errorMessage = response.error;
    } catch { /* Provider and network errors use the safe fallback above. */ }
  }
  const chatId = useRef<string | null>(null);
  // The transcript as last saved or opened, so opening a chat never marks it as just updated.
  const lastSaved = useRef("");
  const [savedChats, setSavedChats] = useState<SavedChatSummary[]>([]);
  const announce = useRef(onChatIdChange);
  useEffect(() => { announce.current = onChatIdChange; }, [onChatIdChange]);
  const refreshSaved = useCallback(() => { const storage = local(); if (storageKey && storage) setSavedChats(listSavedChats(storage, storageKey)); }, [storageKey]);
  // This tab's open chat, so a trip to a lesson and back (or a call) picks up the same conversation.
  const remember = useCallback((current: UIMessage[]) => {
    if (!storageKey) return;
    try { safeSessionStorage.setItem(storageKey, JSON.stringify({ version: 1, chatId: chatId.current, messages: current })); } catch { /* Chat still works without storage. */ }
  }, [storageKey]);
  const persist = useCallback((current: UIMessage[]) => {
    const storage = local();
    if (!storageKey || !storage || !current.length) return;
    const transcript = JSON.stringify(current);
    if (transcript === lastSaved.current) return;
    lastSaved.current = transcript;
    const isNew = !chatId.current;
    chatId.current ??= newSavedChatId();
    if (saveChat(storage, storageKey, chatId.current, current)) {
      refreshSaved();
      if (isNew) announce.current?.(chatId.current);
    }
  }, [storageKey, refreshSaved]);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!storageKey) return;
    refreshSaved();
    if (initialQuestion) return;
    const storage = local();
    const requested = storage && requestedChatId ? loadSavedChat(storage, storageKey, requestedChatId) : null;
    if (requested) { chatId.current = requestedChatId!; lastSaved.current = JSON.stringify(requested); setMessages(requested); return; }
    if (requestedChatId) announce.current?.(null);
    try {
      const saved = JSON.parse(safeSessionStorage.getItem(storageKey) ?? "null");
      if (saved?.version === 1 && isChatMessages(saved.messages) && saved.messages.length) {
        if (isSavedChatId(saved.chatId)) { chatId.current = saved.chatId; lastSaved.current = JSON.stringify(saved.messages); announce.current?.(saved.chatId); }
        setMessages(saved.messages);
      }
    } catch { /* A blocked or outdated browser store starts a fresh chat. */ }
  }, [storageKey, initialQuestion, requestedChatId, setMessages, refreshSaved]);
  // Saved once the question is asked and again when the reply finishes, not on every streamed word.
  useEffect(() => {
    if (!storageKey || !restored.current || status === "streaming") return;
    remember(messages);
    persist(messages);
  }, [messages, storageKey, status, remember, persist]);
  useEffect(() => { latestMessages.current = messages; }, [messages]);
  useEffect(() => () => { remember(latestMessages.current); persist(latestMessages.current); }, [remember, persist]);
  useEffect(() => {
    if (!storageKey) return;
    const update = (event: StorageEvent) => { if (event.key?.startsWith(`${storageKey}:saved`)) refreshSaved(); };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, [storageKey, refreshSaved]);
  useEffect(() => {
    if (started.current || !initialQuestion) return;
    started.current = true;
    void sendMessage({ text: initialQuestion });
  }, [initialQuestion, sendMessage]);
  const withNext = useRef<Record<string, unknown> | undefined>(undefined);
  const submit = (text: string, extra?: Record<string, unknown>, withNextMessage?: Record<string, unknown>) => {
    if (!text.trim() || busy) return;
    const fields = extra ?? withNext.current;
    withNext.current = withNextMessage;
    clearError(); setInput(""); void sendMessage({ text: text.trim() }, fields ? { body: fields } : undefined);
  };
  const actions = (index: number): SessionChatActions => ({ ask: submit, busy, latest: index === messages.length - 1 });
  const open = (id: string | null, next: UIMessage[]) => {
    void stop(); clearError(); withNext.current = undefined;
    chatId.current = id; lastSaved.current = JSON.stringify(next); setMessages(next); remember(next);
    announce.current?.(id);
  };
  const openSaved = (id: string) => {
    const storage = local();
    const saved = storage && storageKey ? loadSavedChat(storage, storageKey, id) : null;
    if (saved) open(id, saved); else refreshSaved();
  };
  const removeSaved = (id: string) => {
    const storage = local();
    if (storage && storageKey) deleteSavedChat(storage, storageKey, id);
    refreshSaved();
  };
  const recent = savedChats.filter(chat => chat.id !== chatId.current);
  return <div className="session-chat" data-started={messages.length > 0 ? "" : undefined}>
    <div className="session-chat-heading"><div><h1>{title}</h1><p>{description}</p></div>
      {messages.length > 0 && <Button type="button" className="session-chat-reset" onClick={() => { open(null, []); inputRef.current?.focus(); }}>New chat</Button>}
    </div>
    {/* Outside the stick-to-bottom scroller, so the welcome opens at its top. */}
    {messages.length === 0 && <div className="session-chat-welcome">{welcomeAction}<p>Start with something you’re curious about.</p><div className="session-chat-suggestions">{suggestions.map(question => <Button type="button" key={question} onClick={() => submit(question)}>{question}<span aria-hidden="true">↗</span></Button>)}</div>
      {recent.length > 0 && <section className="session-chat-saved" aria-labelledby="session-chat-saved-heading">
        <h2 id="session-chat-saved-heading">Pick up where you left off</h2>
        <ul>{recent.map(chat => <li key={chat.id}>
          <Button type="button" className="session-chat-saved-open" onClick={() => openSaved(chat.id)}><span>{chat.title}</span><time dateTime={new Date(chat.updatedAt).toISOString()}>{savedDate(chat.updatedAt)}</time></Button>
          <Button type="button" className="session-chat-saved-remove" aria-label={`Remove “${chat.title}”`} title="Remove from this browser" onClick={() => removeSaved(chat.id)}><span aria-hidden="true">×</span></Button>
        </li>)}</ul>
        <p>Saved only in this browser, so there’s no account to make. Anyone using this browser can see them.</p>
      </section>}</div>}
    <Conversation className="session-chat-conversation" aria-label="Learning conversation" aria-live="polite" aria-relevant="additions">
      <ConversationContent className="session-chat-conversation-content" scrollClassName="session-chat-scroll">
      {messages.map((message, index) => <article key={message.id} className={`session-chat-message session-chat-${message.role}`} aria-label={message.role === "user" ? "You" : assistantName}>
        <div className="session-chat-speaker">{message.role === "user" ? "You" : assistantName}</div>
        {message.parts.filter(part => part.type === "text").map((part, i) => part.type === "text" && (message.role === "user" ? <p key={i}>{part.text}</p> : renderText
          ? <div key={i} className="session-chat-text">{renderText(message, part.text, busy && index === messages.length - 1, actions(index))}</div>
          : <MarkdownRenderer key={i} content={part.text} isStreaming={busy && index === messages.length - 1} />))}
        {renderData?.(message, actions(index))}
      </article>)}
      {status === "submitted" && <p className="session-chat-working" role="status">Finding helpful lessons…</p>}
      </ConversationContent>
      <ConversationScrollButton className="session-chat-scroll-button" aria-label="Scroll to latest reply" />
    </Conversation>
    {error && <div className="session-chat-error" role="alert"><span>{errorMessage}</span><Button type="button" onClick={() => { clearError(); void regenerate(); }}>Retry</Button></div>}
    <form className="session-chat-composer" onSubmit={event => { event.preventDefault(); submit(input); }}>
      <Field>
        <FieldLabel className="session-chat-label">Your question</FieldLabel>
        <div className="session-chat-input-row"><Textarea ref={inputRef} id="learning-question" value={input} maxLength={4000} rows={2} placeholder="What would you like to understand?" onValueChange={setInput} submitShortcut="enter" />
        {composerAction}
        {busy ? <Button type="button" onClick={() => void stop()}>Stop</Button> : <Button type="submit" disabled={!input.trim()} aria-label="Ask"><span className="session-chat-send-label">Ask </span><span aria-hidden="true">↑</span></Button>}</div>
      </Field>
      {footnote && <p className="session-chat-note">{footnote}</p>}
    </form>
  </div>;
}

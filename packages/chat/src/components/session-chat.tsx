"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StreamingMarkdown } from "./streaming-markdown";
import type { ChatMarkdownRenderer } from "../types";
import { sessionModelMessages } from "../session-messages";
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";

/** Shared Oncobase streaming UI for public, unsaved learning sessions. Hosts
 * supply their content cards without pulling in the care/Convex runtime. */
export function SessionChat({ apiPath, body, initialQuestion, storageKey, title, description, suggestions, renderData, assistantName = "Assistant", footnote, MarkdownRenderer = StreamingMarkdown }: {
  apiPath: string; body?: Record<string, unknown>; initialQuestion?: string;
  storageKey?: string;
  title: string; description: string; suggestions: string[];
  renderData?: (message: UIMessage) => ReactNode;
  MarkdownRenderer?: ChatMarkdownRenderer;
  assistantName?: string; footnote?: string;
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
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (storageKey && !initialQuestion) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved?.version === 1 && Array.isArray(saved.messages) && saved.messages.every((message: UIMessage) => ["user", "assistant"].includes(message.role) && typeof message.id === "string" && Array.isArray(message.parts))) setMessages(saved.messages);
      } catch { /* A blocked or outdated browser store starts a fresh chat. */ }
    }
  }, [storageKey, initialQuestion, setMessages]);
  useEffect(() => {
    if (!storageKey || !restored.current || busy) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, messages })); } catch { /* Chat still works without storage. */ }
  }, [messages, storageKey, busy]);
  useEffect(() => { latestMessages.current = messages; }, [messages]);
  useEffect(() => () => {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, messages: latestMessages.current })); } catch { /* Storage is optional. */ }
  }, [storageKey]);
  useEffect(() => {
    if (started.current || !initialQuestion) return;
    started.current = true;
    void sendMessage({ text: initialQuestion });
  }, [initialQuestion, sendMessage]);
  const submit = (text: string) => {
    if (!text.trim() || busy) return;
    clearError(); setInput(""); void sendMessage({ text: text.trim() });
  };
  return <div className="session-chat">
    <div className="session-chat-heading"><div><h1>{title}</h1><p>{description}</p></div>
      {messages.length > 0 && <button type="button" className="session-chat-reset" onClick={() => { void stop(); setMessages([]); clearError(); inputRef.current?.focus(); }}>New chat</button>}
    </div>
    <Conversation className="session-chat-conversation" aria-label="Learning conversation" aria-live="polite" aria-relevant="additions">
      <ConversationContent className="session-chat-conversation-content" scrollClassName="session-chat-scroll">
      {messages.length === 0 && <div className="session-chat-welcome"><p>Start with something you’re curious about.</p><div className="session-chat-suggestions">{suggestions.map(question => <button type="button" key={question} onClick={() => submit(question)}>{question}<span aria-hidden="true">↗</span></button>)}</div></div>}
      {messages.map((message, index) => <article key={message.id} className={`session-chat-message session-chat-${message.role}`} aria-label={message.role === "user" ? "You" : assistantName}>
        <div className="session-chat-speaker">{message.role === "user" ? "You" : assistantName}</div>
        {message.parts.filter(part => part.type === "text").map((part, i) => part.type === "text" && (message.role === "user" ? <p key={i}>{part.text}</p> : <MarkdownRenderer key={i} content={part.text} isStreaming={busy && index === messages.length - 1} />))}
        {renderData?.(message)}
      </article>)}
      {status === "submitted" && <p className="session-chat-working" role="status">Finding helpful lessons…</p>}
      </ConversationContent>
      <ConversationScrollButton className="session-chat-scroll-button" aria-label="Scroll to latest reply" />
    </Conversation>
    {error && <div className="session-chat-error" role="alert"><span>{errorMessage}</span><button type="button" onClick={() => { clearError(); void regenerate(); }}>Retry</button></div>}
    <form className="session-chat-composer" onSubmit={event => { event.preventDefault(); submit(input); }}>
      <label className="session-chat-label" htmlFor="learning-question">Your question</label>
      <div className="session-chat-input-row"><textarea ref={inputRef} id="learning-question" value={input} maxLength={4000} rows={2} placeholder="What would you like to understand?" onChange={event => setInput(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(input); }
      }} />
      {busy ? <button type="button" onClick={() => void stop()}>Stop</button> : <button type="submit" disabled={!input.trim()}>Ask <span aria-hidden="true">↑</span></button>}</div>
      {footnote && <p className="session-chat-note">{footnote}</p>}
    </form>
  </div>;
}

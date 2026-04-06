"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRef, useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/markdown-renderer";

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export default function ChatPage() {
  const { messages, sendMessage, status, stop } = useChat();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input.trim() });
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      {/* Messages — scrollable, takes remaining space */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-16 text-[var(--text-muted)]">
            <h1 className="text-lg font-semibold text-[var(--foreground)] mb-1">
              Research Assistant
            </h1>
            <p className="text-xs mb-6">
              Ask questions about Diana&apos;s diagnosis, treatment, and research
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
                  onClick={() => sendMessage({ text: q })}
                  className="text-xs px-3 py-1.5 rounded-full border border-[var(--sidebar-border)] hover:bg-[var(--accent-light)] transition-colors text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const text = getTextContent(message);

          if (message.role === "user") {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 bg-[var(--brand)] text-white text-sm whitespace-pre-wrap">
                  {text}
                </div>
              </div>
            );
          }

          if (!text) return null;

          return (
            <div key={message.id} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 bg-[var(--accent-light)] text-[var(--foreground)] text-sm">
                <div className="prose text-sm">
                  <MarkdownRenderer content={text} />
                </div>
              </div>
            </div>
          );
        })}

        {isLoading &&
          (messages.length === 0 ||
            !getTextContent(messages[messages.length - 1])) && (
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
      </div>

      {/* Input — pinned to bottom */}
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

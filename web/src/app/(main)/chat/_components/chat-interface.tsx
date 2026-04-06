"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useRef, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownRenderer } from "@/components/markdown-renderer";

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function storedToUIMessages(
  msgs: Array<{ role: "user" | "assistant"; content: string }>
): UIMessage[] {
  return msgs.map((m, i) => ({
    id: `stored-${i}`,
    role: m.role,
    parts: [{ type: "text" as const, text: m.content }],
  }));
}

interface ChatInterfaceProps {
  conversationId: string | null;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string }>;
}

export function ChatInterface({
  conversationId,
  initialMessages,
}: ChatInterfaceProps) {
  const router = useRouter();
  const createConversation = useMutation(api.conversations.create);
  const saveMessages = useMutation(api.conversations.saveMessages);

  const convIdRef = useRef<Id<"conversations"> | null>(
    conversationId as Id<"conversations"> | null
  );
  const lastSavedIndex = useRef(initialMessages?.length ?? 0);
  const savingRef = useRef(false);

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Save messages to Convex after streaming completes
  const prevStatus = useRef(status);
  useEffect(() => {
    if (prevStatus.current === "streaming" && status === "ready") {
      const unsaved = messages.slice(lastSavedIndex.current);
      if (unsaved.length > 0 && convIdRef.current && !savingRef.current) {
        savingRef.current = true;
        saveMessages({
          conversationId: convIdRef.current,
          messages: unsaved.map((m) => ({
            role: m.role as "user" | "assistant",
            content: getTextContent(m),
            createdAt: Date.now(),
          })),
        }).then(() => {
          lastSavedIndex.current = messages.length;
          savingRef.current = false;
        });
      }
    }
    prevStatus.current = status;
  }, [status, messages, saveMessages]);

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
        // Save the user message immediately since onFinish won't catch it
        lastSavedIndex.current = 0;
        router.replace(`/chat/${id}`);
      }

      sendMessage({ text });
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    },
    [input, isLoading, createConversation, sendMessage, router]
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
                      router.replace(`/chat/${id}`);
                    }
                    sendMessage({ text: q });
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

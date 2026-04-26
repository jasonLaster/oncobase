"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import type { UIMessage } from "ai";
import { useChatRuntime } from "../runtime";

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function messagesToMarkdown(messages: UIMessage[]): string {
  return messages
    .map((m) => {
      const text = getTextContent(m);
      if (!text) return null;
      return m.role === "user" ? `**You:** ${text}` : `**Assistant:** ${text}`;
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/** Dropdown menu for sidebar conversation items */
export function ConversationDropdown({
  conversationId,
}: {
  conversationId: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { convexApi, routes } = useChatRuntime();
  const archiveConversation = useMutation(convexApi.conversations.archive);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  async function handleArchive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await archiveConversation({
      id: conversationId,
    });
    setOpen(false);
    router.push(routes.newChatPath);
  }

  async function handleCopyUrl(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const url = routes.conversationUrl(conversationId, window.location.origin);
    await navigator.clipboard.writeText(url);
    setOpen(false);
  }

  return (
    <div
      ref={ref}
      className="relative"
      onClick={(e) => e.preventDefault()}
    >
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
        aria-label="Conversation actions"
        className="p-0.5 rounded hover:bg-[var(--sidebar-border)] text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3.5" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="8" cy="12.5" r="1.2" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)] shadow-lg z-50 py-1">
          <button
            onClick={handleCopyUrl}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
              <path d="M10 7.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
            </svg>
            Copy link
          </button>
          <div className="border-t border-[var(--sidebar-border)] my-1" />
          <button
            onClick={handleArchive}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)] transition-colors text-left"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="12" height="4" rx="1" />
              <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
              <path d="M6.5 9.5h3" />
            </svg>
            Archive
          </button>
        </div>
      )}
    </div>
  );
}

/** Inline action buttons shown at the bottom of a conversation */
export function ChatBottomActions({
  conversationId,
  messages,
}: {
  conversationId: string | null;
  messages: UIMessage[];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const router = useRouter();
  const { convexApi, routes } = useChatRuntime();
  const archiveConversation = useMutation(convexApi.conversations.archive);

  if (messages.length === 0) return null;

  // Only show after last assistant message
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role !== "assistant") return null;

  async function handleCopyMarkdown() {
    const md = messagesToMarkdown(messages);
    await navigator.clipboard.writeText(md);
    setCopied("markdown");
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleCopyUrl() {
    if (!conversationId) return;
    const url = routes.conversationUrl(conversationId, window.location.origin);
    await navigator.clipboard.writeText(url);
    setCopied("url");
    setTimeout(() => setCopied(null), 2000);
  }

  async function handleArchive() {
    if (!conversationId) return;
    await archiveConversation({
      id: conversationId,
    });
    router.push(routes.newChatPath);
  }

  return (
    <div className="flex items-center gap-1 py-2">
      <button
        onClick={handleCopyMarkdown}
        title="Copy as Markdown"
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="5" y="5" width="9" height="9" rx="1" />
          <path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" />
        </svg>
        {copied === "markdown" ? "Copied!" : "Copy"}
      </button>

      {conversationId && (
        <button
          onClick={handleCopyUrl}
          title="Copy share URL"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5l-1 1" />
            <path d="M10 7.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l1-1" />
          </svg>
          {copied === "url" ? "Copied!" : "Share"}
        </button>
      )}

      {conversationId && (
        <button
          onClick={handleArchive}
          title="Archive conversation"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="4" rx="1" />
            <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
            <path d="M6.5 9.5h3" />
          </svg>
          Archive
        </button>
      )}
    </div>
  );
}

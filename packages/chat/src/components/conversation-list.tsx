"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { ConversationDropdown } from "./chat-actions";
import { useChatRuntime } from "../runtime";

function useActiveConversationId(): string | null {
  const pathname = usePathname();

  const pathnameId = useMemo(() => {
    const match = pathname.match(/^\/chat\/(.+)$/);
    return match ? match[1] : null;
  }, [pathname]);

  const [replaceStateId, setReplaceStateId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const handler = () => {
      if (!mounted) return;
      const match = window.location.pathname.match(/^\/chat\/(.+)$/);
      setReplaceStateId(match ? match[1] : null);
    };
    window.addEventListener("popstate", handler);

    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      // Defer to avoid calling setState during render/hydration
      queueMicrotask(handler);
    };

    return () => {
      mounted = false;
      window.removeEventListener("popstate", handler);
      history.replaceState = origReplace;
    };
  }, []);

  return replaceStateId ?? pathnameId;
}

function ConversationListContent() {
  const { convexApi } = useChatRuntime();
  const conversations = useQuery(convexApi.conversations.list);
  const pathname = usePathname();
  const activeId = useActiveConversationId();
  const isNewChat = pathname === "/chat" && activeId === null;

  return (
    <div className="space-y-0.5">
      <Link
        href="/chat"
        className={`flex items-center gap-1.5 px-2 py-1.5 text-sm rounded transition-colors ${
          isNewChat
            ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
            : "hover:bg-[var(--accent-light)] text-[var(--brand)] font-medium"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="8" y1="3" x2="8" y2="13" />
          <line x1="3" y1="8" x2="13" y2="8" />
        </svg>
        New chat
      </Link>
      {conversations === undefined && (
        <div className="px-2 py-1 text-xs text-[var(--text-muted)]">Loading...</div>
      )}
      {conversations?.map((conv: { _id: string; title: string }) => {
        const isActive = conv._id === activeId;
        return (
          <div key={conv._id} className="group/item flex items-center rounded hover:bg-[var(--accent-light)] transition-colors">
            <Link
              href={`/chat/${conv._id}`}
              onClick={(e) => {
                if (isActive) e.preventDefault();
              }}
              className={`flex-1 min-w-0 px-2 py-1 text-sm rounded truncate transition-colors ${
                isActive
                  ? "text-[var(--brand)] font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
              }`}
              title={conv.title}
            >
              {conv.title}
            </Link>
            <div className="shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity pr-1">
              <ConversationDropdown conversationId={conv._id} />
            </div>
          </div>
        );
      })}
      {conversations?.length === 0 && (
        <div className="px-2 py-1 text-xs text-[var(--text-muted)]">No conversations yet</div>
      )}
      <div className="mt-4 pt-2 border-t border-[var(--sidebar-border)]">
        <Link
          href="/chat/archived"
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
            pathname === "/chat/archived"
              ? "text-[var(--brand)] bg-[var(--accent-light)]"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)]"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="4" rx="1" />
            <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
            <path d="M6.5 9.5h3" />
          </svg>
          View archived
        </Link>
      </div>
    </div>
  );
}

export default function ConversationList() {
  return <ConversationListContent />;
}

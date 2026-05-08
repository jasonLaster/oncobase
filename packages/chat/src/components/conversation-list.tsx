"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { ConversationDropdown } from "./chat-actions";
import { useChatRuntime } from "../runtime";
import type { ChatRoutes } from "../routes";

function useActiveConversationId(routes: ChatRoutes): string | null {
  const pathname = usePathname();

  const pathnameId = useMemo(() => {
    return routes.matchConversationId(pathname);
  }, [pathname, routes]);

  const [replaceStateId, setReplaceStateId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const handler = () => {
      if (!mounted) return;
      setReplaceStateId(routes.matchConversationId(window.location.pathname));
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
  }, [routes]);

  return replaceStateId ?? pathnameId;
}

function ConversationListContent() {
  const { convexApi, copy, routes } = useChatRuntime();
  const conversations = useQuery(convexApi.conversations.list);
  const pathname = usePathname();
  const activeId = useActiveConversationId(routes);
  const isNewChat = routes.isNewChatPath(pathname) && activeId === null;

  return (
    <div className="flex min-h-full flex-col" data-test-id="conversation-list">
      <div className="space-y-0.5">
      <Link
        href={routes.newChatPath}
        data-test-id="conversation-list-new-chat"
        className={`flex items-center gap-1.5 px-2 py-1.5 text-sm rounded transition-colors ${
          isNewChat
            ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
            : "hover:bg-[var(--accent-light)] text-[var(--brand)] font-medium"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.7.7 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
          <path d="m9 11 2 2 4-4" />
        </svg>
        {copy.newChatLabel}
      </Link>
      {conversations === undefined && (
        <div
          className="px-2 py-1 text-xs text-[var(--text-muted)]"
          role="status"
          aria-label="Loading conversations"
          data-test-id="conversation-list-loading"
        >
          {copy.loadingConversations}
        </div>
      )}
      {conversations?.map((conv: { _id: string; title: string }) => {
        const isActive = conv._id === activeId;
        return (
          <div key={conv._id} className="group/item flex items-center rounded hover:bg-[var(--accent-light)] transition-colors">
            <Link
              href={routes.conversationPath(conv._id)}
              onClick={(e) => {
                if (isActive) e.preventDefault();
              }}
              className={`flex-1 min-w-0 px-2 py-1 text-sm rounded truncate transition-colors ${
                isActive
                  ? "text-[var(--brand)] font-medium"
                  : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
              }`}
              title={conv.title}
              data-test-id="conversation-list-item"
              data-conversation-id={conv._id}
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
        <div className="px-2 py-1 text-xs text-[var(--text-muted)]" data-test-id="conversation-list-empty">
          {copy.noConversations}
        </div>
      )}
      </div>
      <div className="mt-auto pt-2 border-t border-[var(--sidebar-border)]">
        <Link
          href={routes.archivedPath}
          data-test-id="conversation-list-archived"
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
            routes.isArchivedPath(pathname)
              ? "text-[var(--brand)] bg-[var(--accent-light)]"
              : "text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--accent-light)]"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="4" rx="1" />
            <path d="M2 6v7a1 1 0 001 1h10a1 1 0 001-1V6" />
            <path d="M6.5 9.5h3" />
          </svg>
          {copy.viewArchivedLabel}
        </Link>
      </div>
    </div>
  );
}

export default function ConversationList() {
  return <ConversationListContent />;
}

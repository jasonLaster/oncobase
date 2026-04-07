"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FileNode } from "@/lib/markdown";
import { ConversationDropdown } from "@/app/(main)/chat/_components/chat-actions";

function hasActiveDescendant(node: FileNode, pathname: string): boolean {
  if (node.type === "file") return pathname === `/${node.slug}`;
  return node.children?.some((child) => hasActiveDescendant(child, pathname)) ?? false;
}

function TreeNode({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const pathname = usePathname();
  const hasActive = hasActiveDescendant(node, pathname);
  const shouldOpen = depth === 0 || hasActive;
  // Reset user toggle when pathname changes by keying on pathname
  const [userToggle, setUserToggle] = useState<{ path: string; open: boolean } | null>(null);
  const open = userToggle?.path === pathname ? userToggle.open : shouldOpen;
  const isActive = pathname === `/${node.slug}`;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setUserToggle({ path: pathname, open: !open })}
          className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-sm rounded hover:bg-[var(--accent-light)] transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-xs opacity-60">{open ? "▼" : "▶"}</span>
          <span className="font-medium truncate">{node.name}</span>
        </button>
        {open && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode key={child.slug} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={`/${node.slug}`}
      className={`block px-2 py-1 text-sm rounded truncate transition-colors ${
        isActive
          ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      title={node.name}
    >
      {node.name}
    </Link>
  );
}


function useActiveConversationId(): string | null {
  const pathname = usePathname();

  // Derive from pathname (covers route changes)
  const pathnameId = useMemo(() => {
    const match = pathname.match(/^\/chat\/(.+)$/);
    return match ? match[1] : null;
  }, [pathname]);

  // Also track replaceState changes (new conversation creation)
  const [replaceStateId, setReplaceStateId] = useState<string | null>(null);

  useEffect(() => {
    const handler = () => {
      const match = window.location.pathname.match(/^\/chat\/(.+)$/);
      setReplaceStateId(match ? match[1] : null);
    };
    window.addEventListener("popstate", handler);

    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
      origReplace(...args);
      handler();
    };

    return () => {
      window.removeEventListener("popstate", handler);
      history.replaceState = origReplace;
    };
  }, []);

  return replaceStateId ?? pathnameId;
}

function ConversationList() {
  const conversations = useQuery(api.conversations.list);
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
      {conversations?.map((conv) => {
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

export function Sidebar({ tree }: { tree: FileNode[] }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const isChat = pathname.startsWith("/chat");

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobile = useCallback(() => setMobileOpen(true), []);

  useEffect(() => {
    queueMicrotask(() => setMobileOpen(false));
  }, [pathname]);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [mobileOpen]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__openSidebar = openMobile;
    return () => {
      delete (window as unknown as Record<string, unknown>).__openSidebar;
    };
  }, [openMobile]);

  return (
    <>
      {/* Mobile drawer overlay */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-300 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={closeMobile} />
        <aside
          className={`absolute top-0 left-0 bottom-0 w-[280px] max-w-[85vw] bg-[var(--sidebar-bg)] shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--sidebar-border)]">
            <Link href="/" className="text-base font-semibold tracking-tight" onClick={closeMobile}>
              Diana&apos;s TNBC
            </Link>
            <button
              onClick={closeMobile}
              aria-label="Close menu"
              className="p-1.5 -mr-1.5 rounded-md hover:bg-[var(--accent-light)] transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="4" y1="4" x2="12" y2="12" />
                <line x1="12" y1="4" x2="4" y2="12" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-0.5">
            {isChat ? <ConversationList /> : tree.map((node) => (
              <TreeNode key={node.slug} node={node} />
            ))}
          </nav>
        </aside>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
        <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
          {isChat ? <ConversationList /> : tree.map((node) => (
            <TreeNode key={node.slug} node={node} />
          ))}
        </nav>
      </aside>
    </>
  );
}

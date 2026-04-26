"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, lazy, Suspense } from "react";
import type { FileNode } from "@/lib/markdown";
import { chatConfigured } from "@/lib/chat-config";

const ConversationList = lazy(() => import("@diana-tnbc/chat/components/conversation-list"));

export function formatName(name: string): string {
  return name.replace(/-/g, " ");
}

export function hasActiveDescendant(node: FileNode, decodedPathname: string): boolean {
  if (node.type === "file") return decodedPathname === `/${node.slug}`;
  return node.children?.some((child) => hasActiveDescendant(child, decodedPathname)) ?? false;
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H5l-3 3V3z" />
    </svg>
  );
}

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-10Z" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M5 2.5h4.5L13 6v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M9.5 2.5V6H13" />
      <path d="M6 9.5h4" />
      <path d="M6 11.5h3" />
    </svg>
  );
}


export function SidebarTopLinks({
  onNavigate,
}: {
  onNavigate?: () => void;
  tree: FileNode[];
}) {
  const pathname = usePathname();

  const links = [
    ...(chatConfigured
      ? [
          {
            href: "/chat",
            label: "Chat with wiki",
            active: pathname.startsWith("/chat"),
            icon: <ChatIcon />,
          },
        ]
      : []),
    ...(process.env.NEXT_PUBLIC_ENABLE_COMMENTS === "true"
      ? [
          {
            href: "/comments",
            label: "View comments",
            active: pathname.startsWith("/comments"),
            icon: <CommentIcon />,
          },
        ]
      : []),
  ];

  return (
    <div className="mb-3">
      <div className="space-y-0.5">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors ${
              link.active
                ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
                : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
            }`}
          >
            {link.icon}
            <span className="truncate">{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function TreeNode({ node, depth = 0, onNavigate }: { node: FileNode; depth?: number; onNavigate?: () => void }) {
  const rawPathname = usePathname();
  const pathname = decodeURIComponent(rawPathname);
  const hasActive = hasActiveDescendant(node, pathname);
  const shouldOpen = depth === 0 || hasActive;
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setUserToggle(null);
  }
  const open = userToggle !== null ? userToggle : shouldOpen;
  const isActive = pathname === `/${node.slug}`;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setUserToggle(!open)}
          className="flex items-center gap-1.5 w-full text-left px-2 py-1 text-sm rounded hover:bg-[var(--accent-light)] transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-xs opacity-60">{open ? "▼" : "▶"}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{formatName(node.name)}</span>
          {node.badge && (
            <span className="ml-auto shrink-0 rounded border border-[var(--brand)]/20 bg-[var(--accent-light)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--brand)]">
              {node.badge}
            </span>
          )}
        </button>
        {open && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeNode key={child.slug} node={child} depth={depth + 1} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (node.type === "pdf") {
    return (
      <a
        href={`/api/file?path=${encodeURIComponent(node.pdfPath!)}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onNavigate}
        className="flex items-center gap-1.5 px-2 py-1 text-sm rounded truncate transition-colors text-[var(--brand)] hover:bg-[var(--accent-light)] hover:text-[var(--brand)]"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        title={`${formatName(node.name)}.pdf`}
      >
        <PdfIcon />
        <span className="truncate">{formatName(node.name)}.pdf</span>
      </a>
    );
  }

  return (
    <Link
      href={`/${node.slug}`}
      onClick={onNavigate}
      className={`block px-2 py-1 text-sm rounded truncate transition-colors ${
        isActive
          ? "bg-[var(--accent-light)] text-[var(--brand)] font-medium"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      title={formatName(node.name)}
    >
      {formatName(node.name)}
    </Link>
  );
}

export function Sidebar({ tree }: { tree: FileNode[] }) {
  const pathname = usePathname();
  const isChat = chatConfigured && pathname.startsWith("/chat");

  return (
    <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
      <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
        <SidebarTopLinks tree={tree} />
        <div className="mb-3 h-px bg-[var(--sidebar-border)]" />
        {isChat ? <Suspense><ConversationList /></Suspense> : tree.map((node) => (
          <TreeNode key={node.slug} node={node} />
        ))}
      </nav>
    </aside>
  );
}

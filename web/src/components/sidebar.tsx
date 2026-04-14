"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, lazy, Suspense } from "react";
import type { FileNode } from "@/lib/markdown";

const ConversationList = lazy(() => import("./conversation-list"));

export function formatName(name: string): string {
  return name.replace(/-/g, " ");
}

export function hasActiveDescendant(node: FileNode, decodedPathname: string): boolean {
  if (node.type === "file") return decodedPathname === `/${node.slug}`;
  return node.children?.some((child) => hasActiveDescendant(child, decodedPathname)) ?? false;
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
          <span className="font-medium truncate">{formatName(node.name)}</span>
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
        className="flex items-center gap-1.5 px-2 py-1 text-sm rounded truncate transition-colors text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
        style={{ paddingLeft: `${depth * 12 + 20}px` }}
        title={`${formatName(node.name)}.pdf`}
      >
        {/* PDF document icon — fold corner */}
        <svg className="shrink-0 opacity-50" width="12" height="14" viewBox="0 0 12 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 1H2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5L7 1Z"
            stroke="currentColor" strokeWidth="1.1"/>
          <path d="M7 1v3.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"/>
          <line x1="2.75" y1="8" x2="9.25" y2="8" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" opacity="0.7"/>
          <line x1="2.75" y1="10" x2="7.5" y2="10" stroke="currentColor" strokeWidth="0.75" strokeLinecap="round" opacity="0.5"/>
        </svg>
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
  const isChat = pathname.startsWith("/chat");

  return (
    <aside className="hidden md:flex flex-col h-full min-h-0 overflow-hidden bg-[var(--sidebar-bg)]">
      <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
        {isChat ? <Suspense><ConversationList /></Suspense> : tree.map((node) => (
          <TreeNode key={node.slug} node={node} />
        ))}
      </nav>
    </aside>
  );
}

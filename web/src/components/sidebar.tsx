"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { FileNode } from "@/lib/markdown";
import {
  setNavigationIntent,
  useNavigationPathname,
} from "@/lib/navigation-intent";

export function formatName(name: string): string {
  return name.replace(/-/g, " ");
}

export function hasActiveDescendant(node: FileNode, decodedPathname: string): boolean {
  if (node.type === "file") return decodedPathname === `/${node.slug}`;
  return node.children?.some((child) => hasActiveDescendant(child, decodedPathname)) ?? false;
}

export function fileTreeNodeKey(node: FileNode) {
  return `${node.type}:${node.slug}:${node.type === "pdf" ? node.pdfPath ?? "" : ""}`;
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

function shouldSetNavigationIntent(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function TreeNode({
  activePathname,
  node,
  depth = 0,
  onNavigate,
}: {
  activePathname: string;
  node: FileNode;
  depth?: number;
  onNavigate?: () => void;
}) {
  const pathname = activePathname;
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
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isTruncated = Boolean(node.truncated);

    if (!hasChildren) {
      return (
        <div>
          <div
            className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-sm rounded text-[var(--text-muted)]"
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            title={isTruncated ? "Loading children" : formatName(node.name)}
          >
            {isTruncated ? (
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-current opacity-50"
              />
            ) : (
              <span aria-hidden="true" className="w-2 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{formatName(node.name)}</span>
            {node.badge && (
              <span className="ml-auto shrink-0 rounded border border-[var(--brand)]/20 bg-[var(--accent-light)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--brand)]">
                {node.badge}
              </span>
            )}
          </div>
        </div>
      );
    }

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
        {open && (
          <div>
            {node.children?.map((child) => (
              <TreeNode
                activePathname={activePathname}
                key={fileTreeNodeKey(child)}
                node={child}
                depth={depth + 1}
                onNavigate={onNavigate}
              />
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
      onClick={(event) => {
        if (shouldSetNavigationIntent(event)) {
          setNavigationIntent(`/${node.slug}`);
        }
        onNavigate?.();
      }}
      data-selected-file-tree-item={isActive ? "true" : undefined}
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
  const pathname = useNavigationPathname();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = navRef.current;
      const selectedItem = nav?.querySelector<HTMLElement>(
        '[data-selected-file-tree-item="true"]',
      );
      if (!nav || !selectedItem) return;

      const navRect = nav.getBoundingClientRect();
      const selectedRect = selectedItem.getBoundingClientRect();
      const isVisible =
        selectedRect.top >= navRect.top &&
        selectedRect.bottom <= navRect.bottom;

      if (!isVisible) {
        selectedItem.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="sidebar"
    >
      <nav
        ref={navRef}
        className="min-h-0 flex-1 select-none space-y-0.5 overflow-y-auto p-2"
        data-test-id="sidebar-tree"
      >
        {tree.map((node) => (
          <TreeNode
            activePathname={pathname}
            key={fileTreeNodeKey(node)}
            node={node}
          />
        ))}
      </nav>
    </aside>
  );
}

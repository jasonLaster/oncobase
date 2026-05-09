import { useStore } from "@livestore/react";
import {
  expandCompactFileTree,
  type CompactFileNode,
  type FileNode,
} from "@diana-tnbc/wiki-content";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { fileTree$, pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray, slugFromPath } from "../wiki-utils";

function useWikiTree() {
  const fileTreeRow = useStore().store.useQuery(fileTree$) as { treeJson: string } | null;
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  return useMemo(() => {
    if (fileTreeRow) {
      return expandCompactFileTree(parseJsonArray<CompactFileNode>(fileTreeRow.treeJson));
    }
    return pages.map((page) => ({
      name: page.slug.split("/").at(-1) ?? page.slug,
      slug: page.slug,
      type: "file" as const,
    }));
  }, [fileTreeRow, pages]);
}

export function Sidebar() {
  const tree = useWikiTree();
  return (
    <aside className="sidebar">
      <div className="sidebar-heading">File tree</div>
      <nav>
        {tree.map((node) => (
          <TreeNode key={node.slug} node={node} />
        ))}
      </nav>
    </aside>
  );
}

function pageTitleFromPath(pathname: string) {
  if (pathname === "/") return "Home";
  const slug = slugFromPath(pathname);
  return (slug.split("/").at(-1) ?? slug).replace(/-/g, " ");
}

export function MobileNav() {
  const tree = useWikiTree();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        className="bottom-nav-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        <span>{pageTitleFromPath(location.pathname)}</span>
        <ChevronUpIcon size={16} aria-hidden="true" />
      </button>
      <div className={`bottom-nav-sheet ${open ? "open" : ""}`}>
        <button
          className="bottom-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={close}
        />
        <div className="bottom-nav-panel">
          <div className="bottom-nav-handle" aria-hidden="true" />
          <div className="bottom-nav-header">
            <strong>Pages</strong>
            <button type="button" onClick={close} aria-label="Close navigation">
              <XIcon size={16} aria-hidden="true" />
            </button>
          </div>
          <nav>
            {tree.map((node) => (
              <TreeNode key={node.slug} node={node} onNavigate={close} />
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

function TreeNode({
  node,
  depth = 0,
  onNavigate,
}: {
  node: FileNode;
  depth?: number;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const [open, setOpen] = useState(depth < 1);
  const active = location.pathname === hrefForSlug(node.slug);

  if (node.type === "directory") {
    return (
      <div>
        <button
          className="tree-directory"
          type="button"
          onClick={() => setOpen((value) => !value)}
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          {open ? (
            <ChevronDownIcon size={14} aria-hidden="true" />
          ) : (
            <ChevronRightIcon size={14} aria-hidden="true" />
          )}
          <span>{node.name.replace(/-/g, " ")}</span>
        </button>
        {open
          ? node.children?.map((child) => (
              <TreeNode
                key={child.slug}
                node={child}
                depth={depth + 1}
                onNavigate={onNavigate}
              />
            ))
          : null}
      </div>
    );
  }

  if (node.type === "pdf") {
    return (
      <a
        className="tree-link pdf"
        href={`/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`}
        style={{ paddingLeft: depth * 12 + 24 }}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
      >
        {node.name.replace(/-/g, " ")}.pdf
      </a>
    );
  }

  return (
    <Link
      className={`tree-link ${active ? "active" : ""}`}
      style={{ paddingLeft: depth * 12 + 24 }}
      to={hrefForSlug(node.slug)}
      onClick={onNavigate}
    >
      {node.name.replace(/-/g, " ")}
    </Link>
  );
}

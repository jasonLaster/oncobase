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
  FileTextIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { fileTree$, pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray, slugFromPath } from "../wiki-utils";

const TREE_EXPANSION_KEY = "wiki-vite-expanded-directories";

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

function readExpandedDirectories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TREE_EXPANSION_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string => typeof item === "string"))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function writeExpandedDirectories(slugs: Set<string>) {
  try {
    localStorage.setItem(TREE_EXPANSION_KEY, JSON.stringify(Array.from(slugs)));
  } catch {
    // Sidebar expansion is a convenience, not critical cache state.
  }
}

function collectActiveAncestors(nodes: FileNode[], activeSlug: string) {
  const ancestors = new Set<string>();

  const visit = (node: FileNode, currentAncestors: string[]): boolean => {
    if (node.slug === activeSlug) {
      currentAncestors.forEach((slug) => ancestors.add(slug));
      return true;
    }

    if (node.type !== "directory" || !node.children) return false;

    const nextAncestors = [...currentAncestors, node.slug];
    const found = node.children.some((child) => visit(child, nextAncestors));
    if (found) ancestors.add(node.slug);
    return found;
  };

  nodes.forEach((node) => visit(node, []));
  return ancestors;
}

function useTreeExpansion(tree: FileNode[]) {
  const location = useLocation();
  const activeSlug = slugFromPath(location.pathname);
  const [expandedSlugs, setExpandedSlugs] = useState(readExpandedDirectories);
  const activeAncestorSlugs = useMemo(
    () => collectActiveAncestors(tree, activeSlug),
    [activeSlug, tree],
  );
  const toggleDirectory = useCallback((slug: string) => {
    setExpandedSlugs((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      writeExpandedDirectories(next);
      return next;
    });
  }, []);

  return { activeAncestorSlugs, expandedSlugs, toggleDirectory };
}

export function Sidebar() {
  const tree = useWikiTree();
  const { activeAncestorSlugs, expandedSlugs, toggleDirectory } = useTreeExpansion(tree);

  return (
    <aside className="sidebar" data-test-id="wiki-sidebar">
      <div className="sidebar-heading">File tree</div>
      <nav>
        {tree.map((node) => (
          <TreeNode
            key={treeNodeKey(node)}
            node={node}
            activeAncestorSlugs={activeAncestorSlugs}
            expandedSlugs={expandedSlugs}
            onToggleDirectory={toggleDirectory}
          />
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

function treeNodeKey(node: FileNode) {
  return `${node.type}:${node.slug}:${node.pdfPath ?? ""}`;
}

export function MobileNav() {
  const tree = useWikiTree();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const { activeAncestorSlugs, expandedSlugs, toggleDirectory } = useTreeExpansion(tree);
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
        data-test-id="bottom-nav-trigger"
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
              <TreeNode
                key={treeNodeKey(node)}
                node={node}
                activeAncestorSlugs={activeAncestorSlugs}
                expandedSlugs={expandedSlugs}
                onNavigate={close}
                onToggleDirectory={toggleDirectory}
              />
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
  activeAncestorSlugs,
  expandedSlugs,
  onNavigate,
  onToggleDirectory,
}: {
  node: FileNode;
  depth?: number;
  activeAncestorSlugs: Set<string>;
  expandedSlugs: Set<string>;
  onNavigate?: () => void;
  onToggleDirectory: (slug: string) => void;
}) {
  const location = useLocation();
  const active = location.pathname === hrefForSlug(node.slug);

  if (node.type === "directory") {
    const open =
      depth < 1 || activeAncestorSlugs.has(node.slug) || expandedSlugs.has(node.slug);

    return (
      <div>
        <button
          className="tree-directory"
          type="button"
          onClick={() => onToggleDirectory(node.slug)}
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
                key={treeNodeKey(child)}
                node={child}
                depth={depth + 1}
                activeAncestorSlugs={activeAncestorSlugs}
                expandedSlugs={expandedSlugs}
                onNavigate={onNavigate}
                onToggleDirectory={onToggleDirectory}
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
        <FileTextIcon size={14} aria-hidden="true" />
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

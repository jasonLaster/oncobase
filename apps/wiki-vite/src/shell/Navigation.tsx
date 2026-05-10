import { useStore } from "@livestore/react";
import {
  expandCompactFileTree,
  type CompactFileNode,
} from "@diana-tnbc/wiki-content";
import {
  WikiMobileNavigation,
  WikiMobileNavigationSheet,
  WikiSidebar,
  collectActiveAncestors,
  formatTreeNodeName,
  type WikiNavigationNode,
  type WikiTreePageLinkRenderArgs,
} from "@diana-tnbc/wiki-shell";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { ChatConversationList } from "../chat/ChatConversationList";
import { ChatProviders } from "../chat/ChatProviders";
import { fileTree$, pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray, slugFromPath } from "../wiki-utils";

const TREE_EXPANSION_KEY = "wiki-vite-expanded-directories";

function useWikiTree() {
  const fileTreeRow = useStore().store.useQuery(fileTree$) as { treeJson: string } | null;
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  return useMemo<WikiNavigationNode[]>(() => {
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
    if (Array.isArray(parsed)) {
      return new Map(
        parsed
          .filter((item): item is string => typeof item === "string")
          .map((slug) => [slug, true]),
      );
    }
    if (parsed && typeof parsed === "object") {
      return new Map(
        Object.entries(parsed)
          .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
      );
    }
    return new Map<string, boolean>();
  } catch {
    return new Map<string, boolean>();
  }
}

function writeExpandedDirectories(slugs: Map<string, boolean>) {
  try {
    localStorage.setItem(TREE_EXPANSION_KEY, JSON.stringify(Object.fromEntries(slugs)));
  } catch {
    // Sidebar expansion is a convenience, not critical cache state.
  }
}

function useTreeExpansion(tree: WikiNavigationNode[]) {
  const location = useLocation();
  const activeSlug = slugFromPath(location.pathname);
  const [expandedSlugs, setExpandedSlugs] = useState(readExpandedDirectories);
  const activeAncestorSlugs = useMemo(
    () => collectActiveAncestors(tree, activeSlug),
    [activeSlug, tree],
  );
  const toggleDirectory = useCallback((slug: string, open: boolean) => {
    setExpandedSlugs((current) => {
      const next = new Map(current);
      next.set(slug, !open);
      writeExpandedDirectories(next);
      return next;
    });
  }, []);

  return { activeAncestorSlugs, expandedSlugs, toggleDirectory };
}

export function Sidebar() {
  const tree = useWikiTree();
  const location = useLocation();
  const activeSlug = slugFromPath(location.pathname);
  const { activeAncestorSlugs, expandedSlugs, toggleDirectory } = useTreeExpansion(tree);

  return (
    <WikiSidebar
      activeAncestorSlugs={activeAncestorSlugs}
      activeSlug={activeSlug}
      data-test-id="wiki-sidebar"
      expandedSlugs={expandedSlugs}
      getFileHref={fileHrefForNode}
      onToggleDirectory={toggleDirectory}
      renderPageLink={renderPageLink}
      tree={tree}
    />
  );
}

function pageTitleFromPath(pathname: string) {
  if (pathname === "/") return "Home";
  const slug = slugFromPath(pathname);
  return formatTreeNodeName(slug.split("/").at(-1) ?? slug);
}

function fileHrefForNode(node: WikiNavigationNode) {
  return `/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`;
}

function renderPageLink({
  active,
  children,
  className,
  node,
  onNavigate,
  style,
}: WikiTreePageLinkRenderArgs) {
  return (
    <Link
      className={className}
      aria-current={active ? "page" : undefined}
      style={style}
      to={hrefForSlug(node.slug)}
      onClick={onNavigate}
    >
      {children}
    </Link>
  );
}

export function MobileNav() {
  const tree = useWikiTree();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const isChatRoute = location.pathname.startsWith("/chat");
  const activeSlug = slugFromPath(location.pathname);
  const { activeAncestorSlugs, expandedSlugs, toggleDirectory } = useTreeExpansion(tree);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (isChatRoute) {
    return (
      <ChatProviders>
        <WikiMobileNavigationSheet
          heading="Chats"
          onOpenChange={setOpen}
          open={open}
          sheetAriaLabel="Chat navigation"
          sheetId="mobile-chat-navigation"
          title="Chat with wiki"
        >
          <nav data-test-id="bottom-nav-chat-list">
            <ChatConversationList />
          </nav>
        </WikiMobileNavigationSheet>
      </ChatProviders>
    );
  }

  return (
    <WikiMobileNavigation
      activeAncestorSlugs={activeAncestorSlugs}
      activeSlug={activeSlug}
      expandedSlugs={expandedSlugs}
      getFileHref={fileHrefForNode}
      onOpenChange={setOpen}
      onToggleDirectory={toggleDirectory}
      open={open}
      renderPageLink={renderPageLink}
      title={pageTitleFromPath(location.pathname)}
      tree={tree}
    />
  );
}

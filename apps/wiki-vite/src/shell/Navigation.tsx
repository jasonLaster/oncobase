import { useStore } from "@livestore/react";
import {
  expandCompactFileTree,
  type CompactFileNode,
} from "@oncobase/wiki-content";
import {
  WikiMobileNavigation,
  WikiMobileNavigationSheet,
  WikiSidebar,
  collectActiveAncestors,
  formatTreeNodeName,
  type WikiNavigationNode,
  type WikiTreePageLinkRenderArgs,
} from "@oncobase/wiki-shell";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChatConversationList } from "../chat/ChatConversationList";
import { ChatProviders } from "../chat/ChatProviders";
import { fileTree$, pageIndex$ } from "../livestore/queries";
import type { PageIndexRow } from "../types";
import { hrefForSlug, parseJsonArray, slugFromPath } from "../wiki-utils";
import {
  setNavigationIntentForSlug,
  useNavigationSlug,
} from "./navigation-intent";

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
  const locationSlug = slugFromPath(location.pathname);
  const activeSlug = useNavigationSlug(locationSlug);
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
  const { pathname } = useLocation();
  const activeSlug = slugFromPath(pathname);
  const { activeAncestorSlugs, expandedSlugs, toggleDirectory } = useTreeExpansion(tree);
  const renderPageLink = usePageLinkRenderer();

  return (
    <WikiSidebar
      activeAncestorSlugs={activeAncestorSlugs}
      activeSlug={activeSlug}
      data-test-id="wiki-sidebar"
      expandedSlugs={expandedSlugs}
      getFileHref={fileHrefForNode}
      heading={null}
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

function usePageLinkRenderer() {
  const navigate = useNavigate();

  return useCallback(
    ({
      active,
      children,
      className,
      node,
      onNavigate,
      style,
    }: WikiTreePageLinkRenderArgs) => {
      const href = hrefForSlug(node.slug);
      return (
        <Link
          className={className}
          aria-current={active ? "page" : undefined}
          style={style}
          to={href}
          onClick={(event) => {
            if (!shouldSetNavigationIntent(event)) {
              onNavigate?.(event);
              return;
            }

            setNavigationIntentForSlug(node.slug);
            onNavigate?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            navigate(href, { flushSync: true });
          }}
        >
          {children}
        </Link>
      );
    },
    [navigate],
  );
}

export function MobileNav() {
  const tree = useWikiTree();
  const { pathname } = useLocation();
  const renderPageLink = usePageLinkRenderer();
  const isChatRoute = pathname.startsWith("/chat");
  const activeSlug = slugFromPath(pathname);
  const { activeAncestorSlugs, expandedSlugs, toggleDirectory } = useTreeExpansion(tree);
  const [navState, setNavState] = useState({ open: false, pathname });
  const open = navState.pathname === pathname ? navState.open : false;
  const setOpen = useCallback(
    (nextOpen: boolean) => setNavState({ open: nextOpen, pathname }),
    [pathname],
  );

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
      title={pageTitleFromPath(pathname)}
      tree={tree}
    />
  );
}

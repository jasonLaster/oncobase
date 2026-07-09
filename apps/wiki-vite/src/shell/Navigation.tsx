import { useStore } from "@livestore/react";
import {
  expandCompactFileTree,
  transformFileTreeForSidebar,
  type CompactFileNode,
} from "@oncobase/wiki-content";
import { formatFileLabel } from "@oncobase/wiki-content/file-labels";
import { MarkdownTitle } from "@oncobase/wiki-markdown/title-react";
import {
  WikiMobileNavigation,
  WikiMobileNavigationSheet,
  WikiSidebar,
  WikiSidebarSignInPrompt,
  WikiTree,
  collectActiveAncestors,
  type WikiNavigationNode,
  type WikiTreePageLinkRenderArgs,
} from "@oncobase/wiki-shell";
import {
  Activity,
  Archive,
  Beaker,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  ClipboardCheck,
  Crosshair,
  Dna,
  FileText,
  Flame,
  Folder,
  FolderOpen,
  GraduationCap,
  HelpCircle,
  Inbox,
  Info,
  Landmark,
  ListChecks,
  ListTodo,
  Mail,
  MessageCircle,
  Microscope,
  NotebookPen,
  Package,
  Pill,
  ScrollText,
  Search,
  ShieldCheck,
  Syringe,
  Target,
  TrendingUp,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
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
import { ViteActionsMenu, openCommandPalette, useWikiViteAuth } from "./Header";

const TREE_EXPANSION_KEY = "wiki-vite-expanded-directories";
const ICON_SIZE = 14;

const SECTION_ICONS: Record<string, LucideIcon> = {
  about: Info,
  "project-management": ListTodo,
  sources: BookOpen,
  wiki: BookOpen,
  overview: Activity,
  "echo-immune": Activity,
  emails: Mail,
  institutions: Building2,
  insurance: ShieldCheck,
  "meeting-notes": NotebookPen,
  "research-analyses": Beaker,
  "research-articles": BookOpen,
  "test-results": Microscope,
  archived: Archive,
  companies: Briefcase,
  diagnostics: ClipboardCheck,
  education: GraduationCap,
  logistics: Package,
  people: Users,
  prognosis: TrendingUp,
  questions: HelpCircle,
  research: Beaker,
  strategy: Target,
  summary: ScrollText,
  treatment: Pill,
  updates: Calendar,
  "designing-a-vaccine": Syringe,
  "molecular-profiling": Dna,
  "oncology-101": Landmark,
  "reading-a-tumor": Microscope,
  "targeted-therapy-modalities": Crosshair,
};

const FILE_ICONS: Record<string, LucideIcon> = {
  "1-inbox": Inbox,
  "2-urgent": Flame,
  "3-completed": ListChecks,
  "4-backlog": ListChecks,
};

const FILE_ICONS_BY_SLUG: Record<string, LucideIcon> = {
  "about/About": Info,
  "about/Index": Info,
  "about/Journal": NotebookPen,
  "about/Log": ScrollText,
  "about/Terminology": BookOpen,
  "about/overview/index": Activity,
  "about/overview/active-workstreams": ListChecks,
  "about/overview/current-status": ClipboardCheck,
  "about/overview/for-experts": GraduationCap,
  "about/overview/for-friends-and-family": Users,
  "about/overview/for-peers": Users,
  "about/overview/key-context": Target,
  "about/overview/test-tracker": Microscope,
};

function useWikiTree() {
  const fileTreeRow = useStore().store.useQuery(fileTree$) as { treeJson: string } | null;
  const pages = useStore().store.useQuery(pageIndex$) as PageIndexRow[];
  return useMemo<WikiNavigationNode[]>(() => {
    if (fileTreeRow) {
      return transformFileTreeForSidebar(
        expandCompactFileTree(parseJsonArray<CompactFileNode>(fileTreeRow.treeJson)),
      );
    }
    return transformFileTreeForSidebar(
      pages.map((page) => ({
        name: page.slug.split("/").at(-1) ?? page.slug,
        slug: page.slug,
        type: "file" as const,
      })),
    );
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

function lastPathSegment(slug: string) {
  return slug.split("/").filter(Boolean).at(-1) ?? slug;
}

function defaultDirectoryOpen({
  activeAncestorSlugs,
  depth,
  node,
}: {
  activeAncestorSlugs: Set<string>;
  depth: number;
  node: WikiNavigationNode;
}) {
  return activeAncestorSlugs.has(node.slug) || (depth === 0 && node.slug === "wiki");
}

function nodeIcon({
  active,
  node,
  open,
}: {
  active: boolean;
  depth: number;
  node: WikiNavigationNode;
  open?: boolean;
}) {
  const Icon =
    node.type === "directory"
      ? SECTION_ICONS[lastPathSegment(node.slug)] ?? (open ? FolderOpen : Folder)
      : FILE_ICONS_BY_SLUG[node.slug] ?? FILE_ICONS[node.name] ?? FileText;
  return (
    <Icon
      size={ICON_SIZE}
      className={active ? "wiki-shell-tree-icon active" : "wiki-shell-tree-icon"}
      aria-hidden="true"
    />
  );
}

function WorkspaceHeader() {
  const trigger = (
    <button
      type="button"
      aria-label="Workspace menu"
      className="wiki-vite-sidebar-workspace"
      data-test-id="sidebar-workspace-trigger"
    >
      <span className="wiki-vite-sidebar-logo" aria-hidden="true">D</span>
      <span>Diana TNBC</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
  );

  return (
    <div className="wiki-vite-sidebar-workspace-row">
      <ViteActionsMenu trigger={trigger} />
    </div>
  );
}

function SidebarFooter() {
  const { sessionLoading, sessionUser, setSessionUser, submitAuth } = useWikiViteAuth();
  return (
    <div className="wiki-vite-sidebar-footer">
      <WikiSidebarSignInPrompt
        onAuthSubmit={submitAuth}
        onSessionChange={setSessionUser}
        sessionLoading={sessionLoading}
        sessionUser={sessionUser}
      />
      <div className="wiki-vite-sidebar-footer-pills">
        <Link to="/chat" data-test-id="sidebar-ask-wiki">
          <WandSparkles size={ICON_SIZE} aria-hidden="true" />
          <span>Ask wiki</span>
        </Link>
        <button
          type="button"
          data-test-id="sidebar-search"
          onClick={() => openCommandPalette("pages")}
        >
          <Search size={ICON_SIZE} aria-hidden="true" />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
    </div>
  );
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
  const toggleDirectory = useCallback((slug: string, nextOpen: boolean) => {
    setExpandedSlugs((current) => {
      const next = new Map(current);
      next.set(slug, nextOpen);
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
      defaultDirectoryOpen={defaultDirectoryOpen}
      expandedSlugs={expandedSlugs}
      footer={<SidebarFooter />}
      formatNodeName={(name) => formatFileLabel(name)}
      getFileHref={fileHrefForNode}
      heading={<WorkspaceHeader />}
      onToggleDirectory={toggleDirectory}
      renderNodeIcon={nodeIcon}
      renderPageLink={renderPageLink}
      treeTestId="sidebar-tree"
      tree={tree}
    />
  );
}

function pageTitleFromPath(pathname: string) {
  if (pathname === "/") return "Home";
  const slug = slugFromPath(pathname);
  return formatFileLabel(slug.split("/").at(-1) ?? slug);
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
          data-selected-file-tree-item={active ? "true" : undefined}
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
  const { sessionLoading, sessionUser, setSessionUser, submitAuth } = useWikiViteAuth();
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
    <>
      <MobilePageHeader title={pageTitleFromPath(pathname)} onOpenNavigation={() => setOpen(true)} />
      <WikiMobileNavigationSheet
        heading="Pages"
        onOpenChange={setOpen}
        open={open}
        sheetId="mobile-page-navigation"
        title={<MarkdownTitle title={pageTitleFromPath(pathname)} />}
        trigger={false}
      >
        <nav data-test-id="bottom-nav-page-tree">
          <WikiSidebarSignInPrompt
            onAuthSubmit={submitAuth}
            onSessionChange={setSessionUser}
            sessionLoading={sessionLoading}
            sessionUser={sessionUser}
          />
          <WikiTree
            activeAncestorSlugs={activeAncestorSlugs}
            activeSlug={activeSlug}
            defaultDirectoryOpen={defaultDirectoryOpen}
            expandedSlugs={expandedSlugs}
            formatNodeName={(name) => formatFileLabel(name)}
            getFileHref={fileHrefForNode}
            onNavigate={() => setOpen(false)}
            onToggleDirectory={toggleDirectory}
            renderNodeIcon={nodeIcon}
            renderPageLink={renderPageLink}
            tree={tree}
          />
        </nav>
      </WikiMobileNavigationSheet>
      <Link to="/chat" aria-label="Ask wiki" title="Ask wiki" className="wiki-vite-mobile-ask" data-test-id="mobile-ask-wiki">
        <MessageCircle size={19} aria-hidden="true" />
      </Link>
    </>
  );
}

function MobilePageHeader({
  onOpenNavigation,
  title,
}: {
  onOpenNavigation: () => void;
  title: string;
}) {
  return (
    <header className="wiki-vite-mobile-page-header" data-test-id="mobile-page-header">
      <div className="wiki-vite-mobile-title">
        <MarkdownTitle title={title} />
      </div>
      <button
        type="button"
        aria-label="Search files"
        title="Search files"
        data-test-id="mobile-header-search"
        onClick={() => openCommandPalette("pages")}
      >
        <Search size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Open comments"
        title="Open comments"
        data-test-id="mobile-header-comments"
        onClick={() => window.dispatchEvent(new CustomEvent("mobile-comments-panel-open"))}
      >
        <MessageCircle size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label="Open page navigation"
        title="Open page navigation"
        data-test-id="bottom-nav-trigger"
        onClick={onOpenNavigation}
      >
        <ListChecks size={17} aria-hidden="true" />
      </button>
    </header>
  );
}

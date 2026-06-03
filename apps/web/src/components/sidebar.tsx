"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from "react";
import {
  ChevronDown,
  MessageSquareText,
  Search,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  WikiSidebar,
  collectActiveAncestors,
  type WikiTreePageLinkRenderArgs,
  type WikiTreeProps,
} from "@oncobase/wiki-shell";
import type { FileNode } from "@/lib/markdown";
import { ActionsMenu, SidebarSignInPrompt } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";
import { commentsFeatureEnabled } from "@/lib/comments-feature";
import { formatFileLabel } from "@/lib/file-labels";
import {
  setNavigationIntent,
  useNavigationPathname,
} from "@/lib/navigation-intent";

export function formatName(name: string): string {
  return formatFileLabel(name);
}

const ROW_HEIGHT = 30;
const ICON_SIZE = 16;
const ICON_GAP = 10;
const SECTION_INDENT = 12;

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

function WorkspaceHeader() {
  const isDev = process.env.NODE_ENV === "development";
  // The trigger spans most of the header but leaves room on the right
  // for the collapse-sidebar button (rendered absolutely by ResizableLayout
  // at right-2 top-2) to surface on hover without overlapping the click area.
  const trigger = (
    <button
      type="button"
      aria-label="Workspace menu"
      data-test-id="sidebar-workspace-trigger"
      className="group flex h-9 max-w-[calc(100%-2.5rem)] items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--accent-light)]"
    >
      <svg width="22" height="22" viewBox="0 0 32 32" className="shrink-0 rounded-md" aria-hidden="true">
        <rect width="32" height="32" rx="6" fill={isDev ? "#22c55e" : "#4f46e5"} />
        <text x="16" y="23" fontFamily="system-ui, -apple-system, sans-serif" fontSize="22" fontWeight="700" fill="white" textAnchor="middle">D</text>
      </svg>
      <span className="min-w-0 flex-1 truncate">Diana TNBC</span>
      <ChevronDown size={14} className="shrink-0 opacity-50 transition-opacity group-hover:opacity-80" aria-hidden="true" />
    </button>
  );
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 px-2">
      <ActionsMenu trigger={trigger} />
    </div>
  );
}

export function CommentsTreeLink({
  activePathname,
  onNavigate,
}: {
  activePathname: string;
  onNavigate?: () => void;
}) {
  const isActive = activePathname.startsWith("/comments");

  return (
    <Link
      href="/comments"
      onClick={onNavigate}
      data-test-id="sidebar-view-comments"
      data-selected-file-tree-item={isActive ? "true" : undefined}
      className={`group flex items-center rounded-md text-sm transition-colors ${
        isActive
          ? "bg-[var(--accent-light)] font-medium text-[var(--foreground)]"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      }`}
      style={{
        height: `${ROW_HEIGHT}px`,
        paddingLeft: `${SECTION_INDENT}px`,
        paddingRight: "8px",
        gap: `${ICON_GAP}px`,
      }}
      title="Comments"
    >
      <MessageSquareText
        size={ICON_SIZE}
        className={`shrink-0 transition-opacity ${
          isActive ? "opacity-100" : "opacity-50 group-hover:opacity-90"
        }`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]/85">
        Comments
      </span>
    </Link>
  );
}

/**
 * One half of the split footer pill. Centered icon + label, subtle hover.
 */
function FooterPillButton({
  icon: Icon,
  label,
  href,
  onClick,
  active,
  shortcut,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
  testId: string;
}) {
  const className = `group flex flex-1 items-center justify-center gap-2 px-3 py-2 text-[13px] transition-colors ${
    active
      ? "bg-[var(--accent-light)] text-[var(--foreground)] font-medium"
      : "text-[var(--text-muted)] hover:bg-[var(--accent-light)]/60 hover:text-[var(--foreground)]"
  }`;

  const inner = (
    <>
      <Icon
        size={ICON_SIZE}
        className={`shrink-0 transition-opacity ${
          active ? "opacity-100" : "opacity-60 group-hover:opacity-90"
        }`}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
      {shortcut ? (
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded border border-[var(--sidebar-border)] bg-[var(--background)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)] sm:inline-flex">
          {shortcut}
        </kbd>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} data-test-id={testId} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} data-test-id={testId} className={className}>
      {inner}
    </button>
  );
}

function SidebarFooter() {
  const pathname = useNavigationPathname();
  return (
    <div className="shrink-0 space-y-3 px-3 pb-3 pt-1">
      <SidebarSignInPrompt />
      <div className="flex items-stretch overflow-hidden rounded-lg border border-[var(--sidebar-border)] bg-[var(--popover)] shadow-sm">
        <FooterPillButton
          icon={WandSparkles}
          label="Ask wiki"
          href="/chat"
          active={pathname.startsWith("/chat")}
          testId="sidebar-ask-wiki"
        />
        <div aria-hidden="true" className="w-px shrink-0 self-stretch bg-[var(--sidebar-border)]" />
        <FooterPillButton
          icon={Search}
          label="Search"
          onClick={openCommandPalette}
          shortcut="⌘K"
          testId="sidebar-search"
        />
      </div>
    </div>
  );
}

// Legacy default-open rule: only the top-level "wiki" section starts open for a
// new session (active ancestors always open, handled by WikiTree).
const sidebarDirectoryDefaultOpen: NonNullable<
  WikiTreeProps["defaultDirectoryOpen"]
> = (node, depth) => depth === 0 && node.slug === "wiki";

// Match the legacy directory button's accessible name (its label text, no
// "Expand/Collapse" prefix) so existing selectors keep working.
const sidebarDirectoryAriaLabel: NonNullable<
  WikiTreeProps["directoryAriaLabel"]
> = ({ formattedName, node }) =>
  node.badge ? `${formattedName} ${node.badge}` : formattedName;

// File-tree page links for the shared WikiTree. The shared tree supplies the
// icon + label as `children` (via the shared semantic icons); we wrap them in a
// Next.js <Link> that sets the optimistic navigation intent and the
// `data-selected-file-tree-item` marker the auto-scroll + e2e rely on.
function renderSidebarPageLink({
  active,
  children,
  className,
  node,
  onNavigate,
  style,
}: WikiTreePageLinkRenderArgs) {
  return (
    <Link
      href={`/${node.slug}`}
      onClick={(event) => {
        if (shouldSetNavigationIntent(event)) {
          setNavigationIntent(`/${node.slug}`);
        }
        onNavigate?.(event);
      }}
      data-selected-file-tree-item={active ? "true" : undefined}
      className={className}
      style={style}
      title={formatName(node.name)}
    >
      {children}
    </Link>
  );
}

/**
 * Shared WikiTree props for the legacy reader's file tree, used by BOTH the
 * desktop sidebar and the mobile bottom-nav so they render one tree the same
 * way: legacy default-open rule, rich `formatFileLabel` labels, bare directory
 * aria-labels, navigation-intent links, and ephemeral directory toggles that
 * reset on navigation (each route re-applies the default-open rule).
 */
export function useSidebarTreeProps(
  tree: FileNode[],
  pathname: string,
): Pick<
  WikiTreeProps,
  | "activeAncestorSlugs"
  | "activeSlug"
  | "defaultDirectoryOpen"
  | "directoryAriaLabel"
  | "expandedSlugs"
  | "formatNodeName"
  | "onToggleDirectory"
  | "renderPageLink"
  | "tree"
> {
  const activeSlug = decodeURIComponent(pathname).replace(/^\//, "");
  const activeAncestorSlugs = useMemo(
    () => collectActiveAncestors(tree, activeSlug),
    [tree, activeSlug],
  );

  const [expandedSlugs, setExpandedSlugs] = useState<Map<string, boolean>>(
    () => new Map(),
  );
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setExpandedSlugs(new Map());
  }
  const onToggleDirectory = useCallback((slug: string, open: boolean) => {
    setExpandedSlugs((current) => new Map(current).set(slug, !open));
  }, []);

  return {
    activeAncestorSlugs,
    activeSlug,
    defaultDirectoryOpen: sidebarDirectoryDefaultOpen,
    directoryAriaLabel: sidebarDirectoryAriaLabel,
    expandedSlugs,
    formatNodeName: formatName,
    onToggleDirectory,
    renderPageLink: renderSidebarPageLink,
    tree,
  };
}

export function Sidebar({ tree }: { tree: FileNode[] }) {
  const pathname = useNavigationPathname();
  const treeProps = useSidebarTreeProps(tree, pathname);

  // Smooth-scroll the active item into view on navigation. The shared tree has
  // no built-in auto-scroll, so query the rendered nav by its test id.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = document.querySelector<HTMLElement>(
        '[data-test-id="sidebar-tree"]',
      );
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
    <WikiSidebar
      {...treeProps}
      beforeTree={
        commentsFeatureEnabled() ? (
          <CommentsTreeLink activePathname={pathname} />
        ) : null
      }
      data-test-id="sidebar"
      footer={<SidebarFooter />}
      heading={<WorkspaceHeader />}
      treeTestId="sidebar-tree"
    />
  );
}

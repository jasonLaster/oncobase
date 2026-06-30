"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  Archive,
  Beaker,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleCheckBig,
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
  MessageSquareText,
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
import type { FileNode } from "@/lib/markdown";
import { ActionsMenu, SidebarSignInPrompt } from "@/components/actions-menu";
import { openCommandPalette } from "@/components/command-palette";
import { commentsFeatureEnabled } from "@/lib/comments-feature";
import { formatFileLabel } from "@/lib/file-labels";
import {
  setNavigationIntent,
  useNavigationPathname,
} from "@/lib/navigation-intent";
import { SidebarTreeSkeleton } from "@/components/sidebar-tree-skeleton";

export function formatName(name: string): string {
  return formatFileLabel(name);
}

export function hasActiveDescendant(node: FileNode, decodedPathname: string): boolean {
  if (node.type === "file") return decodedPathname === `/${node.slug}`;
  return node.children?.some((child) => hasActiveDescendant(child, decodedPathname)) ?? false;
}

export function fileTreeNodeKey(node: FileNode) {
  return `${node.type}:${node.slug}:${node.type === "pdf" ? node.pdfPath ?? "" : ""}`;
}

// Semantic icon mapping for folders. Keys are the final path segment so the
// same icon applies whether a folder lives at the top level or nested (e.g.
// "research" matches both /research and /wiki/research). Anything not in the
// map falls back to a generic folder icon.
const SECTION_ICONS: Record<string, LucideIcon> = {
  // top-level
  about: Info,
  "project-management": ListTodo,
  sources: BookOpen,
  wiki: BookOpen,

  // about/*
  overview: Activity,

  // sources/*
  "claudes-research": Beaker,
  "echo-immune": Activity,
  emails: Mail,
  institutions: Building2,
  insurance: ShieldCheck,
  kernis: Users,
  "meeting-notes": NotebookPen,
  "research-analyses": Beaker,
  "research-articles": BookOpen,
  "test-results": Microscope,

  // wiki/*
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

  // wiki/education/*
  "designing-a-vaccine": Syringe,
  "molecular-profiling": Dna,
  "oncology-101": Landmark,
  "reading-a-tumor": Microscope,
  "targeted-therapy-modalities": Crosshair,
};

const FILE_ICONS: Record<string, LucideIcon> = {
  "1-inbox": Inbox,
  "2-urgent": Flame,
  "3-completed": CircleCheckBig,
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

function lastPathSegment(slug: string) {
  const i = slug.lastIndexOf("/");
  return i === -1 ? slug : slug.slice(i + 1);
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

const ROW_HEIGHT = 30;
const ICON_SIZE = 16;
const ICON_GAP = 10;
const SECTION_INDENT = 12;
const INDENT_PX = 18;

function rowPadding(depth: number, hasSectionIcon: boolean) {
  if (depth === 0) return SECTION_INDENT;
  // Children align under the parent label, past the icon column at depth 0.
  const base = hasSectionIcon ? SECTION_INDENT + ICON_SIZE + ICON_GAP : SECTION_INDENT;
  return base + (depth - 1) * INDENT_PX;
}

export function TreeNode({
  activePathname,
  node,
  depth = 0,
  expandedSlugs,
  onDirectoryToggle,
  onNavigate,
}: {
  activePathname: string;
  node: FileNode;
  depth?: number;
  expandedSlugs?: Map<string, boolean>;
  onDirectoryToggle?: (slug: string, open: boolean) => void;
  onNavigate?: () => void;
}) {
  const pathname = activePathname;
  const hasActive = hasActiveDescendant(node, pathname);
  const shouldOpen = hasActive || (depth === 0 && node.slug === "wiki");
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setUserToggle(null);
  }
  const controlledOpen = expandedSlugs?.get(node.slug);
  const open =
    controlledOpen !== undefined
      ? controlledOpen
      : userToggle !== null
        ? userToggle
        : shouldOpen;
  const isActive = pathname === `/${node.slug}`;
  const isTopLevel = depth === 0;
  const SectionIcon =
    node.type === "directory"
      ? SECTION_ICONS[lastPathSegment(node.slug)] ?? null
      : null;
  // Add breathing room above top-level sections to separate groups.
  const topLevelSpacing = isTopLevel ? "mt-1" : "";

  if (node.type === "directory") {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const isTruncated = Boolean(node.truncated);
    const DirectoryGlyph = SectionIcon ?? (open ? FolderOpen : Folder);

    if (!hasChildren) {
      return (
        <div className={topLevelSpacing}>
          <div
            className="group flex items-center rounded-md text-sm text-[var(--text-muted)]"
            style={{
              height: `${ROW_HEIGHT}px`,
              paddingLeft: `${rowPadding(depth, true)}px`,
              paddingRight: "8px",
              gap: `${ICON_GAP}px`,
            }}
            title={isTruncated ? "Loading children" : formatName(node.name)}
          >
            <DirectoryGlyph
              size={ICON_SIZE}
              className="shrink-0 opacity-60"
              aria-hidden="true"
            />
            <span className={`min-w-0 flex-1 truncate ${isTopLevel ? "font-medium text-[var(--foreground)]/85" : ""}`}>
              {formatName(node.name)}
            </span>
            {isTruncated && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current opacity-50"
              />
            )}
            {node.badge && (
              <span className="shrink-0 rounded border border-[var(--brand)]/20 bg-[var(--accent-light)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--brand)]">
                {node.badge}
              </span>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className={topLevelSpacing}>
        <button
          type="button"
          aria-expanded={open}
          data-file-tree-slug={node.slug}
          data-file-tree-type={node.type}
          data-file-tree-truncated={isTruncated ? "true" : undefined}
          onClick={() => {
            const nextOpen = !open;
            if (onDirectoryToggle) {
              onDirectoryToggle(node.slug, nextOpen);
            } else {
              setUserToggle(nextOpen);
            }
          }}
          className="group flex w-full items-center rounded-md text-left text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
          style={{
            height: `${ROW_HEIGHT}px`,
            paddingLeft: `${rowPadding(depth, true)}px`,
            paddingRight: "6px",
            gap: `${ICON_GAP}px`,
          }}
        >
          <DirectoryGlyph
            size={ICON_SIZE}
            className="shrink-0 opacity-60 transition-opacity group-hover:opacity-90"
            aria-hidden="true"
          />
          <span className={`min-w-0 flex-1 truncate ${isTopLevel ? "font-medium text-[var(--foreground)]/85" : ""}`}>
            {formatName(node.name)}
          </span>
          {node.badge && (
            <span className="shrink-0 rounded border border-[var(--brand)]/20 bg-[var(--accent-light)] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-[var(--brand)]">
              {node.badge}
            </span>
          )}
          <ChevronRight
            size={12}
            className={`shrink-0 opacity-0 transition-all group-hover:opacity-60 ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
        {open && (
          <div className="pt-0.5">
            {node.children?.map((child) => (
              <TreeNode
                activePathname={activePathname}
                expandedSlugs={expandedSlugs}
                key={fileTreeNodeKey(child)}
                node={child}
                depth={depth + 1}
                onDirectoryToggle={onDirectoryToggle}
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
        data-file-tree-slug={node.slug}
        data-file-tree-type={node.type}
        onClick={onNavigate}
        className={`group flex items-center rounded-md text-sm text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)] ${topLevelSpacing}`}
        style={{
          height: `${ROW_HEIGHT}px`,
          paddingLeft: `${rowPadding(depth, true)}px`,
          paddingRight: "8px",
          gap: `${ICON_GAP}px`,
        }}
        title={`${formatName(node.name)}.pdf`}
      >
        <PdfIcon />
        <span className="min-w-0 flex-1 truncate">{formatName(node.name)}.pdf</span>
      </a>
    );
  }

  const FileGlyph = FILE_ICONS_BY_SLUG[node.slug] ?? FILE_ICONS[node.name] ?? FileText;

  return (
    <Link
      href={`/${node.slug}`}
      onClick={(event) => {
        if (shouldSetNavigationIntent(event)) {
          setNavigationIntent(`/${node.slug}`);
        }
        onNavigate?.();
      }}
      data-file-tree-slug={node.slug}
      data-file-tree-type={node.type}
      data-selected-file-tree-item={isActive ? "true" : undefined}
      className={`group flex items-center rounded-md text-sm transition-colors ${
        isActive
          ? "bg-[var(--accent-light)] text-[var(--foreground)] font-medium"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      } ${topLevelSpacing}`}
      style={{
        height: `${ROW_HEIGHT}px`,
        paddingLeft: `${rowPadding(depth, true)}px`,
        paddingRight: "8px",
        gap: `${ICON_GAP}px`,
      }}
      title={formatName(node.name)}
    >
      <FileGlyph
        size={ICON_SIZE}
        className={`shrink-0 transition-opacity ${
          isActive ? "opacity-100" : "opacity-50 group-hover:opacity-90"
        }`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate">{formatName(node.name)}</span>
    </Link>
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
        paddingLeft: `${rowPadding(0, true)}px`,
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

export function DiagnosticsTreeLink({
  activePathname,
  onNavigate,
}: {
  activePathname: string;
  onNavigate?: () => void;
}) {
  const isActive =
    activePathname.startsWith("/diagnostics") ||
    activePathname.startsWith("/tools/dicom-viewer") ||
    activePathname.startsWith("/tools/dicom-compare");

  return (
    <Link
      href="/diagnostics"
      onClick={onNavigate}
      data-test-id="sidebar-view-diagnostics"
      data-selected-file-tree-item={isActive ? "true" : undefined}
      className={`group flex items-center rounded-md text-sm transition-colors ${
        isActive
          ? "bg-[var(--accent-light)] font-medium text-[var(--foreground)]"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      }`}
      style={{
        height: `${ROW_HEIGHT}px`,
        paddingLeft: `${rowPadding(0, true)}px`,
        paddingRight: "8px",
        gap: `${ICON_GAP}px`,
      }}
      title="Diagnostics"
    >
      <ClipboardCheck
        size={ICON_SIZE}
        className={`shrink-0 transition-opacity ${
          isActive ? "opacity-100" : "opacity-50 group-hover:opacity-90"
        }`}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate font-medium text-[var(--foreground)]/85">
        Diagnostics
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

function SidebarChrome({ children }: { children: ReactNode }) {
  return (
    <aside
      className="hidden h-full min-h-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] md:flex"
      data-test-id="sidebar"
    >
      <WorkspaceHeader />
      {children}
      <SidebarFooter />
    </aside>
  );
}

export function SidebarLoading() {
  return (
    <SidebarChrome>
      <SidebarTreeSkeleton />
    </SidebarChrome>
  );
}

export function Sidebar({ tree }: { tree: FileNode[] }) {
  const pathname = useNavigationPathname();
  const navRef = useRef<HTMLElement>(null);
  const [expandedSlugs, setExpandedSlugs] = useState(() => new Map<string, boolean>());
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setExpandedSlugs(new Map());
  }
  const handleDirectoryToggle = useCallback((slug: string, open: boolean) => {
    setExpandedSlugs((current) => {
      const next = new Map(current);
      next.set(slug, open);
      return next;
    });
  }, []);

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
    <SidebarChrome>
      <nav
        ref={navRef}
        className="min-h-0 flex-1 select-none overflow-y-auto px-1.5 py-2"
        data-test-id="sidebar-tree"
      >
        {commentsFeatureEnabled() ? <CommentsTreeLink activePathname={pathname} /> : null}
        <DiagnosticsTreeLink activePathname={pathname} />
        {tree.map((node) => (
          <TreeNode
            activePathname={pathname}
            expandedSlugs={expandedSlugs}
            key={fileTreeNodeKey(node)}
            node={node}
            onDirectoryToggle={handleDirectoryToggle}
          />
        ))}
      </nav>
    </SidebarChrome>
  );
}

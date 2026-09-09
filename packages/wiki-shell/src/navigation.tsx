import {
  type CSSProperties,
  type ComponentProps,
  type MouseEventHandler,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "./utils.ts";

export type WikiNavigationNode = {
  badge?: string;
  children?: WikiNavigationNode[];
  name: string;
  pdfPath?: string;
  slug: string;
  type: "directory" | "file" | "pdf";
};

export type WikiTreePageLinkRenderArgs = {
  active: boolean;
  children: ReactNode;
  className: string;
  node: WikiNavigationNode;
  onNavigate?: MouseEventHandler;
  style: CSSProperties;
};

export type WikiTreeProps = {
  activeAncestorSlugs: Set<string>;
  activeSlug: string;
  defaultDirectoryOpen?: (args: {
    activeAncestorSlugs: Set<string>;
    depth: number;
    node: WikiNavigationNode;
  }) => boolean;
  directoryAriaLabel?: (args: {
    formattedName: string;
    node: WikiNavigationNode;
    open: boolean;
  }) => string;
  expandedSlugs: Map<string, boolean>;
  formatNodeName?: (name: string, node: WikiNavigationNode) => string;
  getFileHref?: (node: WikiNavigationNode) => string;
  onNavigate?: () => void;
  onToggleDirectory: (slug: string, open: boolean) => void;
  renderNodeIcon?: (args: {
    active: boolean;
    depth: number;
    node: WikiNavigationNode;
    open?: boolean;
  }) => ReactNode;
  renderPageLink: (args: WikiTreePageLinkRenderArgs) => ReactNode;
  tree: WikiNavigationNode[];
};

export type WikiSidebarProps = Omit<ComponentProps<"aside">, "children"> &
  WikiTreeProps & {
    beforeTree?: ReactNode;
    footer?: ReactNode;
    heading?: ReactNode;
    treeTestId?: string;
  };

export function formatTreeNodeName(name: string) {
  return name.replace(/-/g, " ");
}

export function treeNodeKey(node: WikiNavigationNode) {
  return `${node.type}:${node.slug}:${node.pdfPath ?? ""}`;
}

const ancestorIndexes = new WeakMap<WikiNavigationNode[], Map<string, Set<string>>>();

export function collectActiveAncestors(tree: WikiNavigationNode[], activeSlug: string) {
  let index = ancestorIndexes.get(tree);
  if (!index) {
    index = new Map();
    const visit = (nodes: WikiNavigationNode[], parents: string[], seen: Set<string>) => {
      for (const node of nodes) {
        // A document can appear in more than one root (for example a source
        // shortcut). Preserve the recursive tree's first match within each
        // root and the union of active ancestors across roots.
        if (!seen.has(node.slug)) {
          seen.add(node.slug);
          const ancestors = index!.get(node.slug) ?? new Set<string>();
          for (const parent of parents) ancestors.add(parent);
          index!.set(node.slug, ancestors);
        }
        if (node.type === "directory" && node.children) visit(node.children, [...parents, node.slug], seen);
      }
    };
    for (const root of tree) visit([root], [], new Set());
    ancestorIndexes.set(tree, index);
  }
  return new Set(index.get(activeSlug) ?? []);
}

export type WikiTreeRow = { key: string; node: WikiNavigationNode; depth: number; open: boolean; gap: number };

export function flattenVisibleWikiTree({ tree, expandedSlugs, activeAncestorSlugs, defaultDirectoryOpen }: Pick<WikiTreeProps, "tree" | "expandedSlugs" | "activeAncestorSlugs" | "defaultDirectoryOpen">) {
  const rows: WikiTreeRow[] = [];
  const visit = (nodes: WikiNavigationNode[], depth: number, parentPath: string) => {
    nodes.forEach((node, index) => {
      const occurrence = `${parentPath}.${index}`;
      const open = node.type === "directory" && (expandedSlugs.get(node.slug) ??
        defaultDirectoryOpen?.({ activeAncestorSlugs, depth, node }) ??
        (depth < 1 || activeAncestorSlugs.has(node.slug)));
      // Flattening puts shortcuts and their source document in one sibling
      // list. Identity must include the occurrence, not only the target slug.
      rows.push({ key: `${occurrence}:${treeNodeKey(node)}`, node, depth, open, gap: depth === 0 ? 4 : index === 0 ? 2 : 0 });
      if (open && node.children) visit(node.children, depth + 1, occurrence);
    });
  };
  visit(tree, 0, "");
  return rows;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      {open ? <path d="M4 6l4 4 4-4" /> : <path d="M6 4l4 4-4 4" />}
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M5 2.5h4.5L13 6v7.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M9.5 2.5V6H13" />
      <path d="M6 9.5h4" />
      <path d="M6 11.5h3" />
    </svg>
  );
}

export function WikiSidebar({
  activeAncestorSlugs,
  activeSlug,
  beforeTree,
  className,
  defaultDirectoryOpen,
  directoryAriaLabel,
  expandedSlugs,
  formatNodeName,
  footer,
  getFileHref,
  heading = "File tree",
  onNavigate,
  onToggleDirectory,
  renderNodeIcon,
  renderPageLink,
  tree,
  treeTestId,
  ...props
}: WikiSidebarProps) {
  return (
    <aside className={cn("wiki-shell-sidebar sidebar", className)} {...props}>
      {heading ? (
        <div
          className={cn(
            "wiki-shell-sidebar-heading sidebar-heading",
            typeof heading === "string" && "is-label",
          )}
        >
          {heading}
        </div>
      ) : null}
      <nav className="wiki-shell-sidebar-nav" data-test-id={treeTestId}>
        {beforeTree}
        <WikiTree
          activeAncestorSlugs={activeAncestorSlugs}
          activeSlug={activeSlug}
          defaultDirectoryOpen={defaultDirectoryOpen}
          directoryAriaLabel={directoryAriaLabel}
          expandedSlugs={expandedSlugs}
          formatNodeName={formatNodeName}
          getFileHref={getFileHref}
          onNavigate={onNavigate}
          onToggleDirectory={onToggleDirectory}
          renderNodeIcon={renderNodeIcon}
          renderPageLink={renderPageLink}
          tree={tree}
        />
      </nav>
      {footer ? <div className="wiki-shell-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

export function WikiTree({
  activeAncestorSlugs,
  activeSlug,
  defaultDirectoryOpen,
  directoryAriaLabel,
  expandedSlugs,
  formatNodeName,
  getFileHref,
  onNavigate,
  onToggleDirectory,
  renderNodeIcon,
  renderPageLink,
  tree,
}: WikiTreeProps) {
  const rows = useMemo(() => flattenVisibleWikiTree({ tree, expandedSlugs, activeAncestorSlugs, defaultDirectoryOpen }), [tree, expandedSlugs, activeAncestorSlugs, defaultDirectoryOpen]);
  const rootRef = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > 150;
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const focusedIndex = focusedKey ? rows.findIndex(row => row.key === focusedKey) : -1;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => rootRef.current?.parentElement ?? null,
    estimateSize: index => 30 + rows[index].gap,
    getItemKey: useCallback((index: number) => rows[index].key, [rows]),
    overscan: 8,
    scrollMargin,
    rangeExtractor: range => [...new Set([...defaultRangeExtractor(range), ...(focusedIndex >= 0 ? [focusedIndex] : [])])].sort((a, b) => a - b),
  });

  useLayoutEffect(() => {
    if (!virtualized) return;
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!root || !parent) return;
    const measure = () => setScrollMargin(root.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    for (const sibling of parent.children) if (sibling !== root) observer.observe(sibling);
    return () => observer.disconnect();
  }, [virtualized]);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const row = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-tree-row]") ?? [])].find(element => element.dataset.treeRow === pendingFocus.current);
    const target = row?.querySelector<HTMLElement>("button, a[href]");
    if (target) {
      pendingFocus.current = null;
      target.focus({ preventScroll: true });
    }
  });

  const visibleRows = virtualized
    ? virtualizer.getVirtualItems().map(item => ({ row: rows[item.index], index: item.index, start: item.start - scrollMargin }))
    : rows.map((row, index) => ({ row, index, start: 0 }));
  return (
    <div
      className="wiki-shell-tree-root wiki-shell-tree-flat"
      ref={rootRef}
      data-virtualized={virtualized ? "true" : undefined}
      data-visible-row-count={rows.length}
      style={virtualized ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
      onKeyDown={event => {
        if (!virtualized || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
        const element = (event.target as HTMLElement).closest<HTMLElement>("[data-tree-index]");
        if (!element) return;
        const next = Number(element.dataset.treeIndex) + (event.shiftKey ? -1 : 1);
        if (next < 0 || next >= rows.length) return;
        event.preventDefault();
        const key = rows[next].key;
        pendingFocus.current = key;
        setFocusedKey(key);
        virtualizer.scrollToIndex(next, { align: "auto" });
      }}
    >
      {visibleRows.map(({ row, index, start }) => (
        <div
          key={row.key}
          data-tree-row={row.key}
          data-tree-index={index}
          onFocusCapture={() => setFocusedKey(row.key)}
          style={virtualized
            ? { position: "absolute", top: 0, left: 0, width: "100%", paddingTop: row.gap, transform: `translateY(${start}px)` }
            : { paddingTop: row.gap }}
        >
        <WikiTreeNode
          active={row.node.slug === activeSlug}
          depth={row.depth}
          directoryAriaLabel={directoryAriaLabel}
          formatNodeName={formatNodeName}
          getFileHref={getFileHref}
          node={row.node}
          open={row.open}
          onNavigate={onNavigate}
          onToggleDirectory={onToggleDirectory}
          renderNodeIcon={renderNodeIcon}
          renderPageLink={renderPageLink}
        />
        </div>
      ))}
    </div>
  );
}

type WikiTreeNodeProps = Omit<WikiTreeProps, "tree" | "activeAncestorSlugs" | "activeSlug" | "defaultDirectoryOpen" | "expandedSlugs"> & {
  active: boolean;
  depth?: number;
  node: WikiNavigationNode;
  open: boolean;
};

const WikiTreeNode = memo(function WikiTreeNode({
  active,
  depth = 0,
  directoryAriaLabel,
  formatNodeName = formatTreeNodeName,
  getFileHref,
  node,
  open,
  onNavigate,
  onToggleDirectory,
  renderNodeIcon,
  renderPageLink,
}: WikiTreeNodeProps) {
  // Match the original reader: children start beneath the parent label.
  const paddingLeft = depth === 0 ? 12 : 38 + (depth - 1) * 18;
  const formattedName = formatNodeName(node.name, node);

  if (node.type === "directory") {
    const accessibleName = node.badge
      ? `${open ? "Collapse" : "Expand"} ${formattedName} ${node.badge}`
      : `${open ? "Collapse" : "Expand"} ${formattedName}`;

    return (
      <div>
        <button
          aria-label={
            directoryAriaLabel?.({ formattedName, node, open }) ??
            accessibleName
          }
          aria-expanded={open}
          className="wiki-shell-tree-directory tree-directory"
          type="button"
          title={`${open ? "Collapse" : "Expand"} ${formattedName}`}
          onClick={() => onToggleDirectory(node.slug, !open)}
          data-tree-depth={depth}
          style={{ paddingLeft }}
        >
          <span className="wiki-shell-tree-disclosure-text" aria-hidden="true">
            {open ? "▼" : "▶"}
          </span>
          {renderNodeIcon?.({ active: false, depth, node, open }) ?? <ChevronIcon open={open} />}
          <span className="wiki-shell-tree-label">{formattedName}</span>
          {node.badge ? <span className="wiki-shell-tree-badge tree-badge">{node.badge}</span> : null}
          <svg className="wiki-shell-tree-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
        </button>
      </div>
    );
  }

  if (node.type === "pdf") {
    return (
      <a
        className="wiki-shell-tree-link tree-link pdf"
        href={getFileHref?.(node) ?? `/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`}
        data-tree-depth={depth}
        style={{ paddingLeft }}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
      >
        {renderNodeIcon?.({ active: false, depth, node }) ?? <FileIcon />}
        <span className="wiki-shell-tree-label">{formattedName}.pdf</span>
      </a>
    );
  }

  return renderPageLink({
    active,
    children: (
      <>
        {renderNodeIcon?.({ active, depth, node })}
        <span className="wiki-shell-tree-label">{formattedName}</span>
      </>
    ),
    className: cn("wiki-shell-tree-link tree-link", active && "active"),
    node,
    onNavigate,
    style: { paddingLeft },
  });
});

export type WikiMobileNavigationProps = Omit<ComponentProps<"div">, "children" | "title"> &
  WikiTreeProps & {
    beforeTree?: ReactNode;
    onOpenChange: (open: boolean) => void;
    open: boolean;
    title: ReactNode;
  };

export type WikiMobileNavigationSheetProps = Omit<ComponentProps<"div">, "title"> & {
  heading?: ReactNode;
  onNavigate?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  sheetAriaLabel?: string;
  sheetId?: string;
  title: ReactNode;
  trigger?: ReactNode | false;
};

export function WikiMobileNavigationSheet({
  children,
  className,
  heading = "Pages",
  onNavigate,
  onOpenChange,
  open,
  sheetAriaLabel = "Page navigation",
  sheetId = "mobile-page-navigation",
  title,
  trigger,
  ...props
}: WikiMobileNavigationSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    onNavigate?.();
    onOpenChange(false);
  }, [onNavigate, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimeout = window.setTimeout(() => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (firstFocusable ?? panelRef.current)?.focus();
    }, 0);

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      // An account dialog inside the sheet owns Tab and Escape until it closes.
      // The outer capture listener must not dismiss both layers at once.
      if (panelRef.current?.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      // Safari may skip buttons on Tab. Own each step so focus cannot escape.
      event.preventDefault();
      const current = focusable.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (event.shiftKey ? focusable.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next].focus();
    };

    document.addEventListener("keydown", onDocumentKeyDown, { capture: true });
    return () => {
      window.clearTimeout(focusTimeout);
      document.removeEventListener("keydown", onDocumentKeyDown, { capture: true });
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [close, open]);

  return (
    <>
      {trigger === false ? null : (
        trigger ?? (
          <button
            className="wiki-shell-bottom-nav-trigger bottom-nav-trigger"
            data-test-id="bottom-nav-trigger"
            type="button"
            aria-expanded={open}
            aria-controls={sheetId}
            onClick={(event) => {
              event.currentTarget.focus();
              onOpenChange(true);
            }}
          >
            <span>{title}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 10l4-4 4 4" />
            </svg>
          </button>
        )
      )}
      <div
        className={cn("wiki-shell-bottom-nav-sheet bottom-nav-sheet", open && "open", className)}
        {...props}
        data-test-id="bottom-nav-sheet"
        id={sheetId}
        inert={!open}
        role={open ? "dialog" : undefined}
        aria-hidden={open ? undefined : true}
        aria-modal={open ? true : undefined}
        aria-label={sheetAriaLabel}
      >
        <div
          aria-hidden="true"
          className="wiki-shell-bottom-nav-backdrop bottom-nav-backdrop"
          onClick={close}
        />
        <div
          className="wiki-shell-bottom-nav-panel bottom-nav-panel"
          ref={panelRef}
          tabIndex={-1}
        >
          <div className="wiki-shell-bottom-nav-handle bottom-nav-handle" aria-hidden="true" />
          <div className="wiki-shell-bottom-nav-header bottom-nav-header">
            {heading ? <strong>{heading}</strong> : null}
            <button type="button" onClick={close} aria-label="Close navigation">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          {open ? children : null}
        </div>
      </div>
    </>
  );
}

export function WikiMobileNavigation({
  activeAncestorSlugs,
  activeSlug,
  beforeTree,
  className,
  defaultDirectoryOpen,
  directoryAriaLabel,
  expandedSlugs,
  formatNodeName,
  getFileHref,
  onNavigate,
  onOpenChange,
  onToggleDirectory,
  renderNodeIcon,
  open,
  renderPageLink,
  title,
  tree,
  ...props
}: WikiMobileNavigationProps) {
  const close = () => {
    onNavigate?.();
    onOpenChange(false);
  };

  return (
    <WikiMobileNavigationSheet
      className={className}
      onNavigate={onNavigate}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
      {...props}
    >
          <nav>
            {beforeTree}
            <WikiTree
              activeAncestorSlugs={activeAncestorSlugs}
              activeSlug={activeSlug}
              defaultDirectoryOpen={defaultDirectoryOpen}
              directoryAriaLabel={directoryAriaLabel}
              expandedSlugs={expandedSlugs}
              formatNodeName={formatNodeName}
              getFileHref={getFileHref}
              onNavigate={close}
              onToggleDirectory={onToggleDirectory}
              renderNodeIcon={renderNodeIcon}
              renderPageLink={renderPageLink}
              tree={tree}
            />
          </nav>
    </WikiMobileNavigationSheet>
  );
}

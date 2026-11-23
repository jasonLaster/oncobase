import {
  type CSSProperties,
  type ComponentProps,
  type MouseEventHandler,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Drawer, DrawerBackdrop, DrawerClose, DrawerContent, DrawerTrigger } from "@oncobase/ui/drawer";
import { Tree, TreeItem, TreeItemIndicator, TreeItemLabel, type TreeItemData, visibleTreeRows } from "@oncobase/ui/tree";
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
  activeSlug: string;
  /** Slugs of the open directories. */
  expandedSlugs: readonly string[];
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
  /** Must return one element: the tree renders it as the row's label. */
  renderPageLink: (args: WikiTreePageLinkRenderArgs) => ReactElement;
  tree: WikiNavigationNode[];
  treeLabel?: string;
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

export type WikiTreeEntry = { depth: number; gap: number; key: string; node: WikiNavigationNode };

export type WikiTreeIndex = {
  /** Every node, by item value. */
  entries: Map<string, WikiTreeEntry>;
  items: TreeItemData[];
  /** Directory item values by slug: a directory can appear in more than one root. */
  directoryValues: Map<string, string[]>;
  /** The first file item for each slug, the one that takes `current`. */
  fileValues: Map<string, string>;
};

/**
 * The tree as UI SDK items. A shortcut and its source document can share a
 * slug, so an item's value is its occurrence (its index path), not its slug.
 */
export function wikiTreeIndex(tree: WikiNavigationNode[], formatNodeName: (name: string, node: WikiNavigationNode) => string = formatTreeNodeName): WikiTreeIndex {
  const entries = new Map<string, WikiTreeEntry>();
  const directoryValues = new Map<string, string[]>();
  const fileValues = new Map<string, string>();
  const visit = (nodes: WikiNavigationNode[], depth: number, parentPath: string): TreeItemData[] =>
    nodes.map((node, index) => {
      const value = `${parentPath}.${index}`;
      entries.set(value, { depth, gap: depth === 0 ? 4 : index === 0 ? 2 : 0, key: `${value}:${treeNodeKey(node)}`, node });
      const name = formatNodeName(node.name, node);
      if (node.type === "directory") {
        directoryValues.set(node.slug, [...(directoryValues.get(node.slug) ?? []), value]);
        return { value, label: name, children: visit(node.children ?? [], depth + 1, value) };
      }
      if (node.type === "file" && !fileValues.has(node.slug)) fileValues.set(node.slug, value);
      return { value, label: node.type === "pdf" ? `${name}.pdf` : name };
    });
  return { entries, items: visit(tree, 0, ""), directoryValues, fileValues };
}

export function expandedTreeValues(index: WikiTreeIndex, expandedSlugs: Iterable<string>) {
  return [...new Set(expandedSlugs)].flatMap(slug => index.directoryValues.get(slug) ?? []);
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
  activeSlug,
  beforeTree,
  className,
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
  treeLabel,
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
          activeSlug={activeSlug}
          expandedSlugs={expandedSlugs}
          formatNodeName={formatNodeName}
          getFileHref={getFileHref}
          onNavigate={onNavigate}
          onToggleDirectory={onToggleDirectory}
          renderNodeIcon={renderNodeIcon}
          renderPageLink={renderPageLink}
          tree={tree}
          treeLabel={treeLabel}
        />
      </nav>
      {footer ? <div className="wiki-shell-sidebar-footer">{footer}</div> : null}
    </aside>
  );
}

const VIRTUALIZE_AFTER_ROWS = 150;

export function WikiTree({
  activeSlug,
  expandedSlugs,
  formatNodeName = formatTreeNodeName,
  getFileHref,
  onNavigate,
  onToggleDirectory,
  renderNodeIcon,
  renderPageLink,
  tree,
  treeLabel = "Pages",
}: WikiTreeProps) {
  const index = useMemo(() => wikiTreeIndex(tree, formatNodeName), [tree, formatNodeName]);
  const expanded = useMemo(() => expandedTreeValues(index, expandedSlugs), [index, expandedSlugs]);
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const rows = useMemo(() => visibleTreeRows(index.items, expanded), [index, expanded]);
  const rootRef = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > VIRTUALIZE_AFTER_ROWS;
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedValue, setFocusedValue] = useState<string | null>(null);
  const focusedIndex = focusedValue ? rows.findIndex(row => row.item.value === focusedValue) : -1;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => rootRef.current?.parentElement ?? null,
    estimateSize: row => 30 + index.entries.get(rows[row].item.value)!.gap,
    getItemKey: useCallback((row: number) => rows[row].item.value, [rows]),
    overscan: 8,
    scrollMargin,
    // The focused row stays mounted, so the tree's tab stop never unmounts.
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

  // Reveal the current page's row once per page: after a deep link, a search
  // or an in-article link it can sit far outside the sidebar's viewport (or,
  // virtualized, not be rendered at all). Only the nearest scroll that shows
  // it, and never again for the same page, so it cannot fight the reader.
  const currentValue = (activeSlug && index.fileValues.get(activeSlug)) || null;
  const activeIndex = useMemo(() => currentValue ? rows.findIndex(row => row.item.value === currentValue) : -1, [rows, currentValue]);
  const revealedSlug = useRef<string | null>(null);
  useEffect(() => {
    if (activeIndex < 0 || !activeSlug || revealedSlug.current === activeSlug) return;
    // After this frame's layout: the virtual list measures its offset first.
    const frame = requestAnimationFrame(() => {
      const scroller = rootRef.current?.parentElement;
      if (!scroller) return;
      // Marked only once it ran: a cancelled frame (an effect re-run) must retry.
      revealedSlug.current = activeSlug;
      if (virtualized) {
        virtualizer.scrollToIndex(activeIndex, { align: "auto" });
        return;
      }
      const row = rootRef.current?.querySelector<HTMLElement>(`[data-tree-index="${activeIndex}"]`);
      if (!row) return;
      // Scroll the sidebar only. scrollIntoView would also move every other
      // scrollable ancestor, including the page behind an off-canvas sheet.
      const view = scroller.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      const margin = Math.min(48, view.height / 4);
      if (box.top < view.top + margin) scroller.scrollTop -= view.top + margin - box.top;
      else if (box.bottom > view.bottom - margin) scroller.scrollTop += box.bottom - (view.bottom - margin);
    });
    return () => cancelAnimationFrame(frame);
    // The virtualizer instance changes every render; the index and mode decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, activeSlug, virtualized]);

  const onExpandedChange = (next: string[]) => {
    const open = new Set(next);
    const changes = new Map<string, boolean>();
    for (const value of expanded) if (!open.has(value)) changes.set(index.entries.get(value)!.node.slug, false);
    for (const value of next) if (!expandedSet.has(value)) changes.set(index.entries.get(value)!.node.slug, true);
    for (const [slug, nextOpen] of changes) onToggleDirectory(slug, nextOpen);
  };

  const visibleRows = virtualized
    ? virtualizer.getVirtualItems().map(item => ({ row: rows[item.index], start: item.start - scrollMargin }))
    : rows.map(row => ({ row, start: 0 }));
  return (
    <Tree
      aria-label={treeLabel}
      className="wiki-shell-tree-root wiki-shell-tree-flat"
      ref={rootRef}
      items={index.items}
      mode="none"
      current={currentValue}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      onHighlight={(value, { index: rowIndex }) => {
        if (!virtualized) return;
        setFocusedValue(value);
        virtualizer.scrollToIndex(rowIndex, { align: "auto" });
      }}
      data-virtualized={virtualized ? "true" : undefined}
      data-visible-row-count={rows.length}
      style={virtualized ? { height: virtualizer.getTotalSize(), position: "relative" } : undefined}
    >
      {visibleRows.map(({ row, start }) => {
        const entry = index.entries.get(row.item.value)!;
        return (
          <TreeItem
            key={row.item.value}
            value={row.item.value}
            data-tree-row={entry.key}
            data-tree-index={row.index}
            onFocus={virtualized ? () => setFocusedValue(row.item.value) : undefined}
            style={virtualized
              ? { position: "absolute", top: 0, left: 0, width: "100%", paddingTop: entry.gap, transform: `translateY(${start}px)` }
              : { paddingTop: entry.gap }}
          >
            <WikiTreeLabel
              active={entry.node.slug === activeSlug}
              depth={entry.depth}
              formatNodeName={formatNodeName}
              getFileHref={getFileHref}
              node={entry.node}
              open={row.item.children !== undefined && expandedSet.has(row.item.value)}
              onNavigate={onNavigate}
              renderNodeIcon={renderNodeIcon}
              renderPageLink={renderPageLink}
            />
          </TreeItem>
        );
      })}
    </Tree>
  );
}

type WikiTreeLabelProps = Pick<WikiTreeProps, "getFileHref" | "onNavigate" | "renderNodeIcon" | "renderPageLink"> & {
  active: boolean;
  depth: number;
  formatNodeName: (name: string, node: WikiNavigationNode) => string;
  node: WikiNavigationNode;
  open: boolean;
};

function WikiTreeLabel({
  active,
  depth,
  formatNodeName,
  getFileHref,
  node,
  open,
  onNavigate,
  renderNodeIcon,
  renderPageLink,
}: WikiTreeLabelProps) {
  // Match the original reader: children start beneath the parent label.
  const paddingLeft = depth === 0 ? 12 : 38 + (depth - 1) * 18;
  const formattedName = formatNodeName(node.name, node);

  if (node.type === "directory") {
    return (
      <TreeItemLabel
        className="wiki-shell-tree-directory tree-directory"
        data-tree-depth={depth}
        style={{ paddingLeft }}
      >
        <span className="wiki-shell-tree-disclosure-text" aria-hidden="true">
          {open ? "▼" : "▶"}
        </span>
        {renderNodeIcon?.({ active: false, depth, node, open }) ?? <ChevronIcon open={open} />}
        <span className="wiki-shell-tree-label">{formattedName}</span>
        {node.badge ? <span className="wiki-shell-tree-badge tree-badge">{node.badge}</span> : null}
        <TreeItemIndicator
          className="wiki-shell-tree-chevron"
          render={<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>}
        />
      </TreeItemLabel>
    );
  }

  if (node.type === "pdf") {
    return (
      <TreeItemLabel
        render={(
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
        )}
      />
    );
  }

  return (
    <TreeItemLabel
      render={renderPageLink({
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
      })}
    />
  );
}

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
  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onNavigate?.();
        onOpenChange(nextOpen);
      }}
    >
      {trigger === false ? null : (
        trigger ?? (
          <DrawerTrigger
            className="wiki-shell-bottom-nav-trigger bottom-nav-trigger"
            data-test-id="bottom-nav-trigger"
          >
            <span>{title}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 10l4-4 4 4" />
            </svg>
          </DrawerTrigger>
        )
      )}
      <DrawerBackdrop className="wiki-shell-bottom-nav-backdrop bottom-nav-backdrop" />
      <DrawerContent
        className={cn("wiki-shell-bottom-nav-panel bottom-nav-panel", className)}
        {...props}
        data-test-id="bottom-nav-sheet"
        id={sheetId}
        aria-label={sheetAriaLabel}
      >
        <div className="wiki-shell-bottom-nav-handle bottom-nav-handle" aria-hidden="true" />
        <div className="wiki-shell-bottom-nav-header bottom-nav-header">
          {heading ? <strong>{heading}</strong> : null}
          <DrawerClose aria-label="Close navigation">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </DrawerClose>
        </div>
        {children}
      </DrawerContent>
    </Drawer>
  );
}

export function WikiMobileNavigation({
  activeSlug,
  beforeTree,
  className,
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
  treeLabel,
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
          activeSlug={activeSlug}
          expandedSlugs={expandedSlugs}
          formatNodeName={formatNodeName}
          getFileHref={getFileHref}
          onNavigate={close}
          onToggleDirectory={onToggleDirectory}
          renderNodeIcon={renderNodeIcon}
          renderPageLink={renderPageLink}
          tree={tree}
          treeLabel={treeLabel}
        />
      </nav>
    </WikiMobileNavigationSheet>
  );
}

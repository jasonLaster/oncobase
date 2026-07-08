import {
  type CSSProperties,
  type ComponentProps,
  type MouseEventHandler,
  type ReactNode,
  useEffect,
} from "react";
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

export function collectActiveAncestors(tree: WikiNavigationNode[], activeSlug: string) {
  const ancestors = new Set<string>();

  const visit = (node: WikiNavigationNode, currentAncestors: string[]): boolean => {
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

  tree.forEach((node) => visit(node, []));
  return ancestors;
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
  return (
    <>
      {tree.map((node) => (
        <WikiTreeNode
          key={treeNodeKey(node)}
          activeAncestorSlugs={activeAncestorSlugs}
          activeSlug={activeSlug}
          defaultDirectoryOpen={defaultDirectoryOpen}
          directoryAriaLabel={directoryAriaLabel}
          expandedSlugs={expandedSlugs}
          formatNodeName={formatNodeName}
          getFileHref={getFileHref}
          node={node}
          onNavigate={onNavigate}
          onToggleDirectory={onToggleDirectory}
          renderNodeIcon={renderNodeIcon}
          renderPageLink={renderPageLink}
        />
      ))}
    </>
  );
}

type WikiTreeNodeProps = Omit<WikiTreeProps, "tree"> & {
  depth?: number;
  node: WikiNavigationNode;
};

function WikiTreeNode({
  activeAncestorSlugs,
  activeSlug,
  defaultDirectoryOpen,
  depth = 0,
  directoryAriaLabel,
  expandedSlugs,
  formatNodeName = formatTreeNodeName,
  getFileHref,
  node,
  onNavigate,
  onToggleDirectory,
  renderNodeIcon,
  renderPageLink,
}: WikiTreeNodeProps) {
  const indent = depth * 12;
  const formattedName = formatNodeName(node.name, node);

  if (node.type === "directory") {
    const userOpen = expandedSlugs.get(node.slug);
    const open =
      userOpen ??
      defaultDirectoryOpen?.({ activeAncestorSlugs, depth, node }) ??
      (depth < 1 || activeAncestorSlugs.has(node.slug));
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
          style={{ paddingLeft: indent + 8 }}
        >
          <span className="wiki-shell-tree-disclosure-text" aria-hidden="true">
            {open ? "▼" : "▶"}
          </span>
          {renderNodeIcon?.({ active: false, depth, node, open }) ?? <ChevronIcon open={open} />}
          <span>{formattedName}</span>
          {node.badge ? <span className="wiki-shell-tree-badge tree-badge">{node.badge}</span> : null}
        </button>
        {open
          ? node.children?.map((child) => (
              <WikiTreeNode
                key={treeNodeKey(child)}
                activeAncestorSlugs={activeAncestorSlugs}
                activeSlug={activeSlug}
                defaultDirectoryOpen={defaultDirectoryOpen}
                directoryAriaLabel={directoryAriaLabel}
                depth={depth + 1}
                expandedSlugs={expandedSlugs}
                formatNodeName={formatNodeName}
                getFileHref={getFileHref}
                node={child}
                onNavigate={onNavigate}
                onToggleDirectory={onToggleDirectory}
                renderNodeIcon={renderNodeIcon}
                renderPageLink={renderPageLink}
              />
            ))
          : null}
      </div>
    );
  }

  if (node.type === "pdf") {
    return (
      <a
        className="wiki-shell-tree-link tree-link pdf"
        href={getFileHref?.(node) ?? `/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`}
        style={{ paddingLeft: indent + 24 }}
        target="_blank"
        rel="noreferrer"
        onClick={onNavigate}
      >
        {renderNodeIcon?.({ active: false, depth, node }) ?? <FileIcon />}
        {formattedName}.pdf
      </a>
    );
  }

  const active = node.slug === activeSlug;
  return renderPageLink({
    active,
    children: (
      <>
        {renderNodeIcon?.({ active, depth, node })}
        {formattedName}
      </>
    ),
    className: cn("wiki-shell-tree-link tree-link", active && "active"),
    node,
    onNavigate,
    style: { paddingLeft: indent + 24 },
  });
}

export type WikiMobileNavigationProps = Omit<ComponentProps<"div">, "children" | "title"> &
  WikiTreeProps & {
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
  ...props
}: WikiMobileNavigationSheetProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const close = () => {
    onNavigate?.();
    onOpenChange(false);
  };

  return (
    <>
      <button
        className="wiki-shell-bottom-nav-trigger bottom-nav-trigger"
        data-test-id="bottom-nav-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => onOpenChange(true)}
      >
        <span>{title}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
      <div
        className={cn("wiki-shell-bottom-nav-sheet bottom-nav-sheet", open && "open", className)}
        data-test-id="bottom-nav-sheet"
        id={sheetId}
        role={open ? "dialog" : undefined}
        aria-hidden={open ? undefined : true}
        aria-modal={open ? true : undefined}
        aria-label={sheetAriaLabel}
        {...props}
      >
        <button
          className="wiki-shell-bottom-nav-backdrop bottom-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={close}
        />
        <div className="wiki-shell-bottom-nav-panel bottom-nav-panel">
          <div className="wiki-shell-bottom-nav-handle bottom-nav-handle" aria-hidden="true" />
          <div className="wiki-shell-bottom-nav-header bottom-nav-header">
            <strong>{heading}</strong>
            <button type="button" onClick={close} aria-label="Close navigation">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}

export function WikiMobileNavigation({
  activeAncestorSlugs,
  activeSlug,
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

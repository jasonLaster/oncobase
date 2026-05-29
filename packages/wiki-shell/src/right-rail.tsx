import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  scrollElementIntoContainerView,
  useDocumentOutline,
  type OutlineItem,
} from "./outline";
import { cn } from "./utils";

export const COMMENTS_PANE_STORAGE_KEY = "comments-pane-open";
export const COMMENTS_WIDTH_STORAGE_KEY = "comments-pane-width";
export const COMMENTS_MIN_WIDTH = 240;
export const COMMENTS_MAX_WIDTH = 640;
export const COMMENTS_DEFAULT_WIDTH = 384;
export const COMMENTS_COLLAPSED_WIDTH = 64;
export const COMMENTS_PANE_EVENT = "comments-pane-state-change";

export type PaneStateSnapshot = {
  open: boolean;
  width: number;
};

export type OutlineRailButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  variant?: "tab" | "icon" | "list";
};

const SERVER_PANE_STATE_OPEN: PaneStateSnapshot = {
  open: true,
  width: COMMENTS_DEFAULT_WIDTH,
};
const SERVER_PANE_STATE_CLOSED: PaneStateSnapshot = {
  open: false,
  width: COMMENTS_DEFAULT_WIDTH,
};

let paneStateCache: PaneStateSnapshot | null = null;

function readStoredPaneOpen(fallbackOpen: boolean) {
  if (typeof window === "undefined") return fallbackOpen;

  const stored = window.localStorage.getItem(COMMENTS_PANE_STORAGE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return fallbackOpen;
}

function readStoredPaneWidth() {
  if (typeof window === "undefined") return COMMENTS_DEFAULT_WIDTH;

  const stored = window.localStorage.getItem(COMMENTS_WIDTH_STORAGE_KEY);
  if (stored) {
    const nextWidth = Number.parseInt(stored, 10);
    if (nextWidth >= COMMENTS_MIN_WIDTH && nextWidth <= COMMENTS_MAX_WIDTH) {
      return nextWidth;
    }
  }

  return COMMENTS_DEFAULT_WIDTH;
}

function getServerPaneState(defaultOpen: boolean): PaneStateSnapshot {
  return defaultOpen ? SERVER_PANE_STATE_OPEN : SERVER_PANE_STATE_CLOSED;
}

function getPaneStateSnapshot(defaultOpen: boolean): PaneStateSnapshot {
  if (typeof window === "undefined") return getServerPaneState(defaultOpen);
  if (paneStateCache) return paneStateCache;

  paneStateCache = {
    open: readStoredPaneOpen(defaultOpen),
    width: readStoredPaneWidth(),
  };
  return paneStateCache;
}

function subscribeToPaneState(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key &&
      event.key !== COMMENTS_PANE_STORAGE_KEY &&
      event.key !== COMMENTS_WIDTH_STORAGE_KEY
    ) {
      return;
    }

    paneStateCache = null;
    onStoreChange();
  };

  window.addEventListener(COMMENTS_PANE_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(COMMENTS_PANE_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

function updatePaneState(
  defaultOpen: boolean,
  updates: Partial<PaneStateSnapshot>,
  options?: {
    persistOpen?: boolean;
    persistWidth?: boolean;
  },
) {
  if (typeof window === "undefined") return;

  const nextState = {
    ...getPaneStateSnapshot(defaultOpen),
    ...updates,
  };

  paneStateCache = nextState;

  if (options?.persistOpen && updates.open !== undefined) {
    window.localStorage.setItem(
      COMMENTS_PANE_STORAGE_KEY,
      nextState.open ? "1" : "0",
    );
  }

  if (options?.persistWidth && updates.width !== undefined) {
    window.localStorage.setItem(COMMENTS_WIDTH_STORAGE_KEY, String(nextState.width));
  }

  dispatchPaneStateChange();
}

export function dispatchPaneStateChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(COMMENTS_PANE_EVENT));
  }
}

export function usePersistedPaneState(defaultOpen: boolean) {
  const snapshot = useSyncExternalStore(
    subscribeToPaneState,
    () => getPaneStateSnapshot(defaultOpen),
    () => getServerPaneState(defaultOpen),
  );

  const setOpen = useCallback(
    (next: SetStateAction<boolean>) => {
      const currentOpen = getPaneStateSnapshot(defaultOpen).open;
      updatePaneState(
        defaultOpen,
        {
          open: typeof next === "function" ? next(currentOpen) : next,
        },
        { persistOpen: true },
      );
    },
    [defaultOpen],
  );

  const setWidth = useCallback(
    (next: SetStateAction<number>, options?: { persist?: boolean }) => {
      const currentWidth = getPaneStateSnapshot(defaultOpen).width;
      updatePaneState(
        defaultOpen,
        {
          width: typeof next === "function" ? next(currentWidth) : next,
        },
        { persistWidth: options?.persist ?? false },
      );
    },
    [defaultOpen],
  );

  return {
    open: snapshot.open,
    setOpen,
    width: snapshot.width,
    setWidth,
  };
}

export function OutlineRailButton({
  active = false,
  className,
  variant = "icon",
  type = "button",
  ...props
}: OutlineRailButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "wiki-shell-rail-button",
        `wiki-shell-rail-button-${variant}`,
        active && "active",
        className,
      )}
      {...props}
    />
  );
}

export function RailToggleIcon({
  direction,
}: {
  direction: "up" | "down" | "right";
}) {
  const points =
    direction === "up"
      ? "4 10 8 6 12 10"
      : direction === "down"
        ? "4 6 8 10 12 6"
        : "6 4 10 8 6 12";

  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={points} />
    </svg>
  );
}

export type DocumentOutlineShellProps = {
  articleClassName?: string;
  children: ReactNode;
  /**
   * Optional comments pane content. When provided, the rail shows
   * Comments/Outline tabs and hosts this node in its comments view, so the
   * rail chrome (resize, collapse, mobile sheet) is owned entirely by
   * wiki-shell and the comments package only supplies the thread UI.
   */
  comments?: ReactNode;
  contentKey: string;
  defaultOpen?: boolean;
  documentSlug?: string;
  documentTitle?: string;
  pathname?: string;
  scrollRootSelector?: string;
};

function OutlineList({
  activeId,
  items,
  onJump,
}: {
  activeId: string;
  items: OutlineItem[];
  onJump: (item: OutlineItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="wiki-shell-outline-empty">
        No headings found on this page.
      </div>
    );
  }

  return (
    <div className="wiki-shell-outline-list">
      {items.map((item) => (
        <OutlineRailButton
          key={item.id}
          active={activeId === item.id}
          variant="list"
          onClick={() => onJump(item)}
          style={{ "--outline-depth": Math.max(0, item.level - 1) } as CSSProperties}
          title={item.text}
        >
          <span>{item.text}</span>
        </OutlineRailButton>
      ))}
    </div>
  );
}

export function DocumentOutlineShell({
  articleClassName,
  children,
  comments,
  contentKey,
  defaultOpen = false,
  documentSlug,
  documentTitle,
  pathname,
  scrollRootSelector,
}: DocumentOutlineShellProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const { activeId, items } = useDocumentOutline({
    contentKey,
    rootRef: articleRef,
    scrollRootSelector,
  });
  const {
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    width: sidebarWidth,
    setWidth: setSidebarWidth,
  } = usePersistedPaneState(defaultOpen);
  const [view, setView] = useState<"comments" | "outline">("outline");
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const paneWidth = sidebarOpen ? sidebarWidth : COMMENTS_COLLAPSED_WIDTH;

  const hasComments = comments != null;
  const commentsView = hasComments && view === "comments";

  const toggleSidebar = () => setSidebarOpen((current) => !current);
  const openSidebar = () => setSidebarOpen(true);
  const activateComments = () => {
    setView("comments");
    setSidebarOpen(true);
  };
  const activateOutline = () => {
    setView("outline");
    setSidebarOpen(true);
  };

  // Shared rail fragments. When there are no comments, `railTabs` renders the
  // plain "Outline" title and the count always shows, so the outline-only path
  // (used by both readers today) is byte-identical to before.
  const railTabs = hasComments ? (
    <div className="wiki-shell-outline-tabs">
      <OutlineRailButton
        variant="tab"
        active={view === "comments"}
        onClick={activateComments}
      >
        Comments
      </OutlineRailButton>
      <OutlineRailButton
        variant="tab"
        active={view === "outline"}
        onClick={activateOutline}
      >
        Outline
      </OutlineRailButton>
    </div>
  ) : (
    <span className="wiki-shell-outline-title">Outline</span>
  );

  const railHeadingCount = (
    <p className="wiki-shell-outline-count">
      {items.length} heading{items.length === 1 ? "" : "s"}
    </p>
  );
  const railHeadingCountSpan = (
    <span className="wiki-shell-outline-count">
      {items.length} heading{items.length === 1 ? "" : "s"}
    </span>
  );

  const jumpToHeading = (item: OutlineItem) => {
    const root = articleRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`#${CSS.escape(item.id)}`);
    if (!target) return;

    const nextPathname = pathname ?? window.location.pathname;
    window.history.replaceState(null, "", `${nextPathname}#${item.id}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    scrollElementIntoContainerView(target, 24);
  };

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      dragging.current = true;
      startX.current = event.clientX;
      startWidth.current = sidebarWidth;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    [sidebarWidth],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - event.clientX;
      const next = Math.min(
        COMMENTS_MAX_WIDTH,
        Math.max(COMMENTS_MIN_WIDTH, startWidth.current + delta),
      );
      setSidebarWidth(next);
    },
    [setSidebarWidth],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      const delta = startX.current - event.clientX;
      const next = Math.min(
        COMMENTS_MAX_WIDTH,
        Math.max(COMMENTS_MIN_WIDTH, startWidth.current + delta),
      );
      setSidebarWidth(next, { persist: true });
    },
    [setSidebarWidth],
  );

  const railBody = commentsView ? (
    <div className="wiki-shell-comments-pane" data-test-id="comments-pane">
      {comments}
    </div>
  ) : (
    <OutlineList activeId={activeId} items={items} onJump={jumpToHeading} />
  );

  return (
    <div
      className="wiki-shell-outline-root"
      data-right-rail-state={sidebarOpen ? "expanded" : "collapsed"}
      style={
        {
          "--comments-pane-width": `${paneWidth}px`,
          "--comments-mobile-rail-height": sidebarOpen
            ? "min(52dvh, 30rem)"
            : "3.5rem",
        } as CSSProperties
      }
    >
      <div className="wiki-shell-outline-content comments-content-wrapper">
        <div className="wiki-shell-outline-content-inner">
          <article
            ref={articleRef}
            className={cn("wiki-shell-document-article", articleClassName)}
            data-document-slug={documentSlug}
            data-test-id="document-article"
            aria-label={documentTitle}
          >
            {children}
          </article>
        </div>
      </div>

      <aside
        className={cn(
          "wiki-shell-mobile-outline-rail",
          sidebarOpen && "expanded",
        )}
        data-comments-bottom-rail
        data-test-id="mobile-page-outline"
        aria-label="Document outline"
      >
        {sidebarOpen ? (
          <>
            <div className="wiki-shell-mobile-outline-header">
              <div className="wiki-shell-mobile-outline-grip" aria-hidden="true" />
              <div className="wiki-shell-mobile-outline-title-row">
                {railTabs}
                <OutlineRailButton
                  className="wiki-shell-outline-icon-button"
                  onClick={toggleSidebar}
                  aria-label="Collapse outline rail"
                >
                  <RailToggleIcon direction="down" />
                </OutlineRailButton>
              </div>
              {commentsView ? null : railHeadingCount}
            </div>
            <div className="wiki-shell-mobile-outline-body">{railBody}</div>
          </>
        ) : (
          <div className="wiki-shell-mobile-outline-collapsed">
            {railTabs}
            {commentsView ? null : railHeadingCountSpan}
            <OutlineRailButton
              className="wiki-shell-outline-icon-button"
              onClick={openSidebar}
              aria-label="Expand outline rail"
            >
              <RailToggleIcon direction="up" />
            </OutlineRailButton>
          </div>
        )}
      </aside>

      <aside
        className={cn(
          "wiki-shell-right-rail",
          sidebarOpen ? "expanded" : "collapsed",
        )}
        data-outline-state={sidebarOpen ? "expanded" : "collapsed"}
        data-test-id="page-outline"
        data-wiki-shell-right-rail
        aria-label="Document outline"
        style={sidebarOpen ? { width: sidebarWidth } : undefined}
      >
        {sidebarOpen ? (
          <>
            <div
              className="wiki-shell-right-rail-resize"
              role="separator"
              aria-label="Resize outline pane"
              aria-orientation="vertical"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            <div className="wiki-shell-right-rail-header">
              {hasComments ? (
                <div className="wiki-shell-right-rail-header-main">
                  {railTabs}
                  {commentsView ? null : railHeadingCount}
                </div>
              ) : (
                <span className="wiki-shell-outline-title">Outline</span>
              )}
              <OutlineRailButton
                className="wiki-shell-outline-icon-button"
                onClick={toggleSidebar}
                aria-label="Collapse outline pane"
              >
                <RailToggleIcon direction="right" />
              </OutlineRailButton>
            </div>
            <div className="wiki-shell-right-rail-body">{railBody}</div>
          </>
        ) : (
          <>
            {hasComments ? (
              <OutlineRailButton
                onClick={activateComments}
                aria-label="Open comments"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-10Z" />
                </svg>
              </OutlineRailButton>
            ) : null}
            <OutlineRailButton
              active
              className={hasComments ? "wiki-shell-outline-stacked-button" : undefined}
              onClick={hasComments ? activateOutline : openSidebar}
              aria-label="Open outline"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M3 4h10M3 8h10M3 12h6" />
              </svg>
            </OutlineRailButton>
          </>
        )}
      </aside>
    </div>
  );
}

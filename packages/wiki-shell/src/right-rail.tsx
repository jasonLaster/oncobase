import { safeLocalStorage } from "@oncobase/safe-storage";
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
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@oncobase/ui/resizable";
import { SegmentedControl, SegmentedControlItem } from "@oncobase/ui/segmented-control";
import {
  scrollElementIntoContainerView,
  useDocumentOutline,
  type OutlineItem,
} from "./outline.ts";
import { usePanelPixelWidth } from "./resizable-layout.tsx";
import { cn } from "./utils.ts";

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

  const stored = safeLocalStorage.getItem(COMMENTS_PANE_STORAGE_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return fallbackOpen;
}

function readStoredPaneWidth() {
  if (typeof window === "undefined") return COMMENTS_DEFAULT_WIDTH;

  const stored = safeLocalStorage.getItem(COMMENTS_WIDTH_STORAGE_KEY);
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
    safeLocalStorage.setItem(
      COMMENTS_PANE_STORAGE_KEY,
      nextState.open ? "1" : "0",
    );
  }

  if (options?.persistWidth && updates.width !== undefined) {
    safeLocalStorage.setItem(COMMENTS_WIDTH_STORAGE_KEY, String(nextState.width));
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

type RailView = "comments" | "outline";

/** Switches the rail between the comments and this outline. */
function RailViewSwitch({ onActivateComments }: { onActivateComments: () => void }) {
  return (
    <SegmentedControl
      aria-label="Rail view"
      className="wiki-shell-outline-tabs"
      value={"outline" as RailView}
      onValueChange={(value) => {
        if (value === "comments") onActivateComments();
      }}
    >
      <SegmentedControlItem value="comments" className="wiki-shell-rail-button wiki-shell-rail-button-tab">
        Comments
      </SegmentedControlItem>
      <SegmentedControlItem value="outline" className="wiki-shell-rail-button wiki-shell-rail-button-tab">
        Outline
      </SegmentedControlItem>
    </SegmentedControl>
  );
}

const OUTLINE_PANEL_ID = "wiki-outline-pane";

export type DocumentOutlineShellProps = {
  articleClassName?: string;
  children: ReactNode;
  contentKey: string;
  defaultOpen?: boolean;
  documentSlug?: string;
  documentTitle?: string;
  mobileRail?: boolean;
  onActivateComments?: () => void;
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
  contentKey,
  defaultOpen = false,
  documentSlug,
  documentTitle,
  mobileRail = true,
  onActivateComments,
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
  const paneWidth = sidebarOpen ? sidebarWidth : COMMENTS_COLLAPSED_WIDTH;

  const toggleSidebar = () => setSidebarOpen((current) => !current);
  const openSidebar = () => setSidebarOpen(true);

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

  const [paneController] = useState(createResizableController);
  const paneGroupRef = useRef<HTMLDivElement>(null);
  // Until the saved width is applied, styles.css sizes the pane from --comments-pane-width.
  const paneWidthApplied = usePanelPixelWidth(paneController, paneGroupRef, OUTLINE_PANEL_ID, sidebarOpen ? sidebarWidth : null);
  const paneWidthFrom = (layout: number[]) => {
    const group = paneGroupRef.current;
    const handle = group?.querySelector<HTMLElement>('[data-slot="resizable-handle"]');
    if (!group || !handle) return null;
    return Math.round((layout[1]! / 100) * (group.clientWidth - handle.offsetWidth));
  };

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
            data-content-key={contentKey}
            data-test-id="document-article"
            aria-label={documentTitle}
          >
            {children}
          </article>
        </div>
      </div>

      {mobileRail ? (
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
                  {onActivateComments ? (
                    <RailViewSwitch onActivateComments={onActivateComments} />
                  ) : (
                    <span className="wiki-shell-outline-title">Outline</span>
                  )}
                  <OutlineRailButton
                    className="wiki-shell-outline-icon-button"
                    onClick={toggleSidebar}
                    aria-label="Collapse outline rail"
                  >
                    <RailToggleIcon direction="down" />
                  </OutlineRailButton>
                </div>
                <p className="wiki-shell-outline-count">
                  {items.length} heading{items.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="wiki-shell-mobile-outline-body">
                <OutlineList activeId={activeId} items={items} onJump={jumpToHeading} />
              </div>
            </>
          ) : (
            <div className="wiki-shell-mobile-outline-collapsed">
              {onActivateComments ? (
                <RailViewSwitch onActivateComments={onActivateComments} />
              ) : (
                <span className="wiki-shell-outline-title">Outline</span>
              )}
              <span className="wiki-shell-outline-count">
                {items.length} heading{items.length === 1 ? "" : "s"}
              </span>
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
      ) : null}

      {sidebarOpen ? (
        <Resizable
          ref={paneGroupRef}
          className="wiki-shell-right-rail-group"
          controller={paneController}
          onLayoutChange={(layout, details) => {
            if (details.reason === "imperative" || details.reason === "resize") return;
            const next = paneWidthFrom(layout);
            if (next !== null) setSidebarWidth(next);
          }}
          onLayoutCommit={(layout, details) => {
            if (details.reason === "imperative" || details.reason === "resize") return;
            const next = paneWidthFrom(layout);
            if (next !== null) setSidebarWidth(next, { persist: true });
          }}
        >
          <ResizablePanel className="wiki-shell-right-rail-spacer" />
          <ResizableHandle className="wiki-shell-right-rail-resize" aria-label="Resize outline pane" />
          <ResizablePanel
            id={OUTLINE_PANEL_ID}
            render={<aside />}
            className="wiki-shell-right-rail expanded"
            data-outline-state="expanded"
            data-test-id="page-outline"
            data-wiki-shell-right-rail
            data-width-applied={paneWidthApplied || undefined}
            aria-label="Document outline"
            defaultSize={`${COMMENTS_DEFAULT_WIDTH}px`}
            minSize={`${COMMENTS_MIN_WIDTH}px`}
            maxSize={`${COMMENTS_MAX_WIDTH}px`}
          >
            <div className="wiki-shell-right-rail-header">
              {onActivateComments ? (
                <div className="wiki-shell-right-rail-header-main">
                  <RailViewSwitch onActivateComments={onActivateComments} />
                  <p className="wiki-shell-outline-count">
                    {items.length} heading{items.length === 1 ? "" : "s"}
                  </p>
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
            <div className="wiki-shell-right-rail-body">
              <OutlineList activeId={activeId} items={items} onJump={jumpToHeading} />
            </div>
          </ResizablePanel>
        </Resizable>
      ) : (
        <aside
          className="wiki-shell-right-rail collapsed"
          data-outline-state="collapsed"
          data-test-id="page-outline"
          data-wiki-shell-right-rail
          aria-label="Document outline"
        >
          {onActivateComments ? (
            <OutlineRailButton
              onClick={onActivateComments}
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
            className={onActivateComments ? "wiki-shell-outline-stacked-button" : undefined}
            onClick={openSidebar}
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
        </aside>
      )}
    </div>
  );
}

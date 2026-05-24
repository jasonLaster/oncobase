"use client";

import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ThreadData } from "@liveblocks/client";
import { useThreads } from "@liveblocks/react";
import { Comment, Composer, Thread } from "@liveblocks/react-ui";
import {
  AuthDialog,
  type SessionUser,
  useSessionUser,
} from "@/components/actions-menu";
import { cn } from "@/lib/utils";
import { LiveblocksRoom } from "@/components/liveblocks-room";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  buildCommentListItems,
  createThreadMetadata,
  getCommentPlainText,
  getThreadAnchor,
  type CommentThreadMetadata,
  type SelectionAnchor,
  sortThreads,
} from "@/lib/liveblocks-comments";
import { commentsFeatureEnabled } from "@/lib/comments-feature";

type HighlightRect = {
  id: string;
  threadId?: string;
  top: number;
  left: number;
  width: number;
  height: number;
  active: boolean;
  pending: boolean;
};

type SelectionTooltipPosition = {
  top: number;
  left: number;
};

type SidebarMode = "comments" | "outline";

type OutlineItem = {
  id: string;
  text: string;
  level: number;
  key: string;
  parentIds: string[];
};

type SidebarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  variant?: "tab" | "icon" | "list";
};

function SidebarButton({
  active = false,
  className,
  variant = "icon",
  type = "button",
  ...props
}: SidebarButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "cursor-pointer rounded transition-colors active:bg-[var(--accent-light)] active:text-[var(--brand)]",
        variant === "tab" && "flex-1 px-2 py-1 text-xs font-medium",
        variant === "icon" && "flex h-7 w-7 items-center justify-center rounded-md",
        variant === "list" &&
          "block w-full px-2 py-1.5 text-left text-sm text-[var(--text-muted)]",
        active
          ? "bg-[var(--accent-light)] text-[var(--brand)]"
          : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]",
        className
      )}
      {...props}
    />
  );
}

function OutlineButton({
  active,
  ancestor,
  item,
  onClick,
}: {
  active: boolean;
  ancestor: boolean;
  item: OutlineItem;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "location" : undefined}
      data-active-outline-heading={active ? "true" : undefined}
      onClick={onClick}
      style={{ paddingLeft: `${Math.max(0, item.level - 1) * 14 + 12}px` }}
      title={item.text}
      className={cn(
        "relative block w-full cursor-pointer rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
        active
          ? "bg-[var(--brand)]/10 font-medium text-[var(--brand)]"
          : ancestor
            ? "text-[var(--foreground)]"
            : "text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
      )}
    >
      <span className="line-clamp-2">{item.text}</span>
    </button>
  );
}

function RailToggleIcon({ direction }: { direction: "up" | "down" | "right" }) {
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

function getOutlineHeadingText(heading: HTMLHeadingElement): string {
  const clone = heading.cloneNode(true) as HTMLHeadingElement;
  clone
    .querySelectorAll('a[href^="#"], a[aria-hidden="true"], .anchor, .header-anchor, .hash-link')
    .forEach((anchor) => {
      anchor.remove();
    });

  const text = clone.textContent ?? heading.textContent ?? "";
  return text
    .replace(/^#{1,6}\s*/, "")
    .replace(/(?:\s*#\s*)+$/, "")
    .trim();
}

function getOutlineHeadings(root: HTMLElement): OutlineItem[] {
  const headings = Array.from(
    root.querySelectorAll<HTMLHeadingElement>("h1[id], h2[id], h3[id], h4[id]")
  );
  const parentStack: Array<{ id: string; level: number }> = [];

  return headings.map((heading, index) => {
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1]!.level >= level
    ) {
      parentStack.pop();
    }

    const item = {
      id: heading.id,
      text: getOutlineHeadingText(heading) || heading.id,
      level,
      key: `${heading.id}:${index}`,
      parentIds: parentStack.map((parent) => parent.id),
    };
    parentStack.push({ id: heading.id, level });
    return item;
  });
}

function getActiveHeadingId(root: HTMLElement, scrollRoot: HTMLElement | null) {
  const headings = Array.from(
    root.querySelectorAll<HTMLHeadingElement>("h1[id], h2[id], h3[id], h4[id]")
  );
  if (headings.length === 0) return null;

  const scrollRootTop = scrollRoot?.getBoundingClientRect().top ?? 0;
  const activationLine = scrollRootTop + 112;
  let activeHeading = headings[0]!;

  for (const heading of headings) {
    const rect = heading.getBoundingClientRect();
    if (rect.top <= activationLine) {
      activeHeading = heading;
      continue;
    }
    break;
  }

  return activeHeading.id;
}

function useDocumentOutline(
  articleRef: React.RefObject<HTMLElement | null>,
  scrollRootRef: React.RefObject<HTMLElement | null>,
  children: ReactNode
) {
  const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;

    let frameId: number | null = null;

    const updateActiveHeading = () => {
      frameId = null;
      if (!root.isConnected) return;
      setActiveHeadingId(getActiveHeadingId(root, scrollRootRef.current));
    };

    const scheduleActiveHeadingUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateActiveHeading);
    };

    const updateOutline = () => {
      setOutlineItems(getOutlineHeadings(root));
      scheduleActiveHeadingUpdate();
    };

    updateOutline();
    const observer = new MutationObserver(updateOutline);
    observer.observe(root, { childList: true, subtree: true });

    const scrollRoot = scrollRootRef.current;
    scrollRoot?.addEventListener("scroll", scheduleActiveHeadingUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleActiveHeadingUpdate);

    return () => {
      observer.disconnect();
      scrollRoot?.removeEventListener("scroll", scheduleActiveHeadingUpdate);
      window.removeEventListener("resize", scheduleActiveHeadingUpdate);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [articleRef, children, scrollRootRef]);

  return { activeHeadingId, outlineItems };
}

const COMMENTS_PANE_STORAGE_KEY = "comments-pane-open";
const COMMENTS_WIDTH_STORAGE_KEY = "comments-pane-width";
const COMMENTS_MIN_WIDTH = 240;
const COMMENTS_MAX_WIDTH = 640;
const COMMENTS_DEFAULT_WIDTH = 384; // 24rem
const COMMENTS_COLLAPSED_WIDTH = 64; // w-16
const DESKTOP_SIDEBAR_TOP_OFFSET = 24;
const COMMENTS_PANE_EVENT = "comments-pane-state-change";

type PaneStateSnapshot = {
  open: boolean;
  width: number;
};

let paneStateCache: PaneStateSnapshot | null = null;
const SERVER_PANE_STATE_OPEN: PaneStateSnapshot = {
  open: true,
  width: COMMENTS_DEFAULT_WIDTH,
};
const SERVER_PANE_STATE_CLOSED: PaneStateSnapshot = {
  open: false,
  width: COMMENTS_DEFAULT_WIDTH,
};

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
    const nextWidth = parseInt(stored, 10);
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
  if (typeof window === "undefined") {
    return getServerPaneState(defaultOpen);
  }

  if (paneStateCache) {
    return paneStateCache;
  }

  paneStateCache = {
    open: readStoredPaneOpen(defaultOpen),
    width: readStoredPaneWidth(),
  };

  return paneStateCache;
}

function subscribeToPaneState(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

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
  }
) {
  if (typeof window === "undefined") {
    return;
  }

  const nextState = {
    ...getPaneStateSnapshot(defaultOpen),
    ...updates,
  };

  paneStateCache = nextState;

  if (options?.persistOpen && updates.open !== undefined) {
    window.localStorage.setItem(
      COMMENTS_PANE_STORAGE_KEY,
      nextState.open ? "1" : "0"
    );
  }

  if (options?.persistWidth && updates.width !== undefined) {
    window.localStorage.setItem(
      COMMENTS_WIDTH_STORAGE_KEY,
      String(nextState.width)
    );
  }

  window.dispatchEvent(new Event(COMMENTS_PANE_EVENT));
}

function usePersistedPaneState(defaultOpen: boolean) {
  const snapshot = useSyncExternalStore(
    subscribeToPaneState,
    () => getPaneStateSnapshot(defaultOpen),
    () => getServerPaneState(defaultOpen)
  );

  const setOpen = useCallback(
    (next: React.SetStateAction<boolean>) => {
      const currentOpen = getPaneStateSnapshot(defaultOpen).open;
      updatePaneState(
        defaultOpen,
        {
          open: typeof next === "function" ? next(currentOpen) : next,
        },
        { persistOpen: true }
      );
    },
    [defaultOpen]
  );

  const setWidth = useCallback(
    (
      next: React.SetStateAction<number>,
      options?: { persist?: boolean }
    ) => {
      const currentWidth = getPaneStateSnapshot(defaultOpen).width;
      updatePaneState(
        defaultOpen,
        {
          width: typeof next === "function" ? next(currentWidth) : next,
        },
        { persistWidth: options?.persist ?? false }
      );
    },
    [defaultOpen]
  );

  return {
    open: snapshot.open,
    setOpen,
    width: snapshot.width,
    setWidth,
  };
}

function getScrollContainer(element: HTMLElement | null) {
  if (!element) return null;

  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }

  return document.scrollingElement instanceof HTMLElement
    ? document.scrollingElement
    : document.documentElement;
}

function scrollElementIntoContainerView(
  target: HTMLElement,
  offset: number = DESKTOP_SIDEBAR_TOP_OFFSET
) {
  const scrollContainer = getScrollContainer(target);
  if (!scrollContainer) return;

  const targetRect = target.getBoundingClientRect();

  if (
    scrollContainer === document.documentElement ||
    scrollContainer === document.body ||
    scrollContainer === document.scrollingElement
  ) {
    const nextTop = window.scrollY + targetRect.top - offset;
    window.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const nextTop =
    scrollContainer.scrollTop + targetRect.top - containerRect.top - offset;
  scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
}

function updateThreadQueryParam(threadId: string | null) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (threadId) {
    url.searchParams.set("thread", threadId);
  } else {
    url.searchParams.delete("thread");
  }

  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

function getRangeOffsets(root: HTMLElement, range: Range) {
  const beforeStart = range.cloneRange();
  beforeStart.selectNodeContents(root);
  beforeStart.setEnd(range.startContainer, range.startOffset);

  const beforeEnd = range.cloneRange();
  beforeEnd.selectNodeContents(root);
  beforeEnd.setEnd(range.endContainer, range.endOffset);

  return {
    start: beforeStart.toString().length,
    end: beforeEnd.toString().length,
  };
}

function captureSelection(root: HTMLElement): SelectionAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.commonAncestorContainer) ||
    range.toString().trim().length === 0
  ) {
    return null;
  }

  const { start, end } = getRangeOffsets(root, range);
  if (end <= start) return null;

  const fullText = root.textContent ?? "";
  return {
    start,
    end,
    quote: fullText.slice(start, end),
    prefix: fullText.slice(Math.max(0, start - 32), start),
    suffix: fullText.slice(end, Math.min(fullText.length, end + 32)),
  };
}

function findTextNodeAtOffset(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let lastTextNode: Text | null = null;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    lastTextNode = node;
    const length = node.textContent?.length ?? 0;

    if (remaining <= length) {
      return { node, offset: remaining };
    }

    remaining -= length;
  }

  if (!lastTextNode) return null;
  return {
    node: lastTextNode,
    offset: lastTextNode.textContent?.length ?? 0,
  };
}

function restoreRange(root: HTMLElement, anchor: SelectionAnchor) {
  const start = findTextNodeAtOffset(root, anchor.start);
  const end = findTextNodeAtOffset(root, anchor.end);

  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function getRangeAnchorElement(range: Range) {
  let node: Node | null = range.startContainer;

  if (node.nodeType === Node.TEXT_NODE) {
    return node.parentElement;
  }

  if (node instanceof HTMLElement) {
    return node;
  }

  while (node) {
    if (node instanceof HTMLElement) return node;
    node = node.parentNode;
  }

  return null;
}

function DraftSelectionThreadCard({
  anchor,
  metadata,
  onDismiss,
}: {
  anchor: SelectionAnchor;
  metadata: CommentThreadMetadata | undefined;
  onDismiss: () => void;
}) {
  return (
    <div
      data-comment-draft-thread
      data-comment-list-item="draft-selection"
      data-anchor-start={anchor.start}
      className="rounded-xl border border-[var(--sidebar-border)] bg-[var(--background)] transition"
    >
      <div className="border-b border-[var(--sidebar-border)] px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Linked selection
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
          >
            Clear
          </button>
        </div>
        <p className="line-clamp-3 text-sm text-[var(--foreground)]">
          {anchor.quote}
        </p>
      </div>
      <div className="px-1 py-1">
        <Composer
          key={`${anchor.start}-${anchor.end}`}
          metadata={metadata}
          autoFocus
          className="lb-composer-override lb-composer-draft-thread"
          onComposerSubmit={onDismiss}
        />
      </div>
    </div>
  );
}

function CommentSignInPrompt({
  context = "comment",
}: {
  context?: "comment" | "selection";
}) {
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const { setUser } = useSessionUser();

  function handleAuthSuccess(nextUser: SessionUser) {
    setUser(nextUser);
    window.dispatchEvent(new CustomEvent("wiki-auth-session-change"));
  }

  return (
    <>
      <div
        data-test-id="comments-sign-in-state"
        className="rounded-xl border border-dashed border-[var(--sidebar-border)] bg-[var(--background)] px-4 py-5 text-sm"
      >
        <p className="font-medium text-[var(--foreground)]">
          Sign in to leave a comment
        </p>
        {context === "selection" ? (
          <p className="mt-1 leading-6 text-[var(--text-muted)]">
            Your selected text is ready. Sign in to attach a comment to it.
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setAuthDialogOpen(true)}
          className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-indigo-600 bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:border-indigo-700 hover:bg-indigo-700"
        >
          Sign in
        </button>
      </div>

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        onAuthSuccess={handleAuthSuccess}
      />
    </>
  );
}

function CommentsShell({
  documentSlug,
  documentTitle,
  children,
}: {
  documentSlug: string;
  documentTitle: string;
  children: ReactNode;
}) {
  const threadsResult = useThreads();
  const { loadingUser, user: sessionUser } = useSessionUser();
  const canComment = Boolean(sessionUser);
  const threads = useMemo(
    () => (threadsResult.isLoading || threadsResult.error ? [] : threadsResult.threads),
    [threadsResult.isLoading, threadsResult.error, threadsResult.threads]
  );
  const articleRef = useRef<HTMLElement | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingSelectionId = useId();
  const [pendingSelection, setPendingSelection] = useState<SelectionAnchor | null>(null);
  const [composerMode, setComposerMode] = useState<"selection" | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [selectionTooltip, setSelectionTooltip] = useState<SelectionTooltipPosition | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("comments");
  const { activeHeadingId, outlineItems } = useDocumentOutline(
    articleRef,
    scrollRootRef,
    children
  );
  const [showResolvedThreads, setShowResolvedThreads] = useState(false);
  const {
    open: commentsOpen,
    setOpen: setCommentsOpen,
    width: commentsWidth,
    setWidth: setCommentsWidth,
  } = usePersistedPaneState(true);
  const commentsDragging = useRef(false);
  const commentsStartX = useRef(0);
  const commentsStartWidth = useRef(0);

  const onCommentsPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      commentsDragging.current = true;
      commentsStartX.current = e.clientX;
      commentsStartWidth.current = commentsWidth;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [commentsWidth]
  );

  const onCommentsPointerMove = useCallback((e: React.PointerEvent) => {
    if (!commentsDragging.current) return;
    // Dragging left increases width (right sidebar)
    const delta = commentsStartX.current - e.clientX;
    const next = Math.min(
      COMMENTS_MAX_WIDTH,
      Math.max(COMMENTS_MIN_WIDTH, commentsStartWidth.current + delta)
    );
    setCommentsWidth(next);
  }, [setCommentsWidth]);

  const onCommentsPointerUp = useCallback((e: React.PointerEvent) => {
    if (!commentsDragging.current) return;
    commentsDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const delta = commentsStartX.current - e.clientX;
    const next = Math.min(
      COMMENTS_MAX_WIDTH,
      Math.max(COMMENTS_MIN_WIDTH, commentsStartWidth.current + delta)
    );
    setCommentsWidth(next, { persist: true });
  }, [setCommentsWidth]);

  const sortedThreads = useMemo(() => sortThreads(threads), [threads]);
  const visibleThreads = useMemo(
    () =>
      (showResolvedThreads ? sortedThreads : sortedThreads.filter((thread) => !thread.resolved))
        .filter((thread) => getThreadAnchor(thread)),
    [showResolvedThreads, sortedThreads]
  );
  const numberedThreads = useMemo(
    () =>
      visibleThreads
        .filter((thread) => getThreadAnchor(thread))
        .map((thread) => ({
          thread,
          anchor: getThreadAnchor(thread)!,
        })),
    [visibleThreads]
  );
  const effectiveComposerMode =
    composerMode === "selection" && !pendingSelection ? null : composerMode;
  const effectiveActiveThreadId = visibleThreads.some(
    (thread) => thread.id === activeThreadId
  )
    ? activeThreadId
    : null;
  const activeHeadingParentIds = useMemo(() => {
    return new Set(
      outlineItems.find((item) => item.id === activeHeadingId)?.parentIds ?? []
    );
  }, [activeHeadingId, outlineItems]);

  const toggleCommentsPane = () => {
    setCommentsOpen((current) => !current);
  };
  const toggleSidebarMode = useCallback(
    (mode: SidebarMode) => {
      if (commentsOpen && sidebarMode === mode) {
        setCommentsOpen(false);
        return;
      }

      setSidebarMode(mode);
      setCommentsOpen(true);
    },
    [commentsOpen, setCommentsOpen, sidebarMode]
  );

  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;

    const update = () => {
      if (!root.isConnected) return;

      const rootRect = root.getBoundingClientRect();
      const nextRects: HighlightRect[] = [];

      for (const { thread, anchor } of numberedThreads) {
        const range = restoreRange(root, anchor);
        if (!range) continue;
        const rects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0
        );
        const active = thread.id === effectiveActiveThreadId;

        rects.forEach((rect, rectIndex) => {
          nextRects.push({
            id: `${thread.id}:${rectIndex}`,
            threadId: thread.id,
            active,
            pending: false,
            top: rect.top - rootRect.top + root.scrollTop,
            left: rect.left - rootRect.left,
            width: rect.width,
            height: rect.height,
          });
        });
      }

      if (pendingSelection) {
        const range = restoreRange(root, pendingSelection);
        if (range) {
          const rects = Array.from(range.getClientRects()).filter(
            (rect) => rect.width > 0 && rect.height > 0
          );
          const firstRect = rects[0];

          if (firstRect) {
            setSelectionTooltip({
              top: firstRect.top - rootRect.top + root.scrollTop - 40,
              left: Math.min(
                Math.max(8, firstRect.left - rootRect.left),
                Math.max(8, root.clientWidth - 140)
              ),
            });
          } else {
            setSelectionTooltip(null);
          }

          rects.forEach((rect, rectIndex) => {
            nextRects.push({
              id: `${pendingSelectionId}:${rectIndex}`,
              active: false,
              pending: true,
              top: rect.top - rootRect.top + root.scrollTop,
              left: rect.left - rootRect.left,
              width: rect.width,
              height: rect.height,
            });
          });
        }
      } else {
        setSelectionTooltip(null);
      }

      setHighlightRects(nextRects);
    };

    const scheduleUpdate = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(update);
    };

    scheduleUpdate();

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(root);
    window.addEventListener("resize", scheduleUpdate);
    root.addEventListener("scroll", scheduleUpdate, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      root.removeEventListener("scroll", scheduleUpdate);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [effectiveActiveThreadId, numberedThreads, pendingSelection, pendingSelectionId]);

  const handlePointerUp = () => {
    window.setTimeout(() => {
      const root = articleRef.current;
      if (!root) return;

      const nextSelection = captureSelection(root);
      if (!nextSelection) {
        setPendingSelection(null);
        setComposerMode(null);
        return;
      }

      setActiveThreadId(null);
      updateThreadQueryParam(null);
      setPendingSelection(nextSelection);
      setComposerMode(null);
    }, 0);
  };

  const handleArticleClick = (event: React.MouseEvent<HTMLElement>) => {
    const root = articleRef.current;
    if (!root) return;

    const target = event.target as HTMLElement;
    if (
      target.closest(
        "button, a, input, textarea, select, [role='button'], [contenteditable='true']"
      )
    ) {
      return;
    }

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    const rootRect = root.getBoundingClientRect();
    const x = event.clientX - rootRect.left;
    const y = event.clientY - rootRect.top + root.scrollTop;
    const clickedThreadId = highlightRects.find(
      (rect) =>
        rect.threadId &&
        !rect.pending &&
        x >= rect.left &&
        x <= rect.left + rect.width &&
        y >= rect.top &&
        y <= rect.top + rect.height
    )?.threadId;

    if (!clickedThreadId) return;
    event.preventDefault();
    focusThreadById(clickedThreadId);
  };

  const focusThread = useCallback((thread: ThreadData, options?: { syncUrl?: boolean }) => {
    const root = articleRef.current;
    const anchor = getThreadAnchor(thread);
    if (!anchor) return;

    setPendingSelection(null);
    setComposerMode(null);
    setSidebarMode("comments");
    setCommentsOpen(true);
    setActiveThreadId(thread.id);
    if (options?.syncUrl !== false) {
      updateThreadQueryParam(thread.id);
    }

    if (!root) return;

    const range = restoreRange(root, anchor);
    if (!range) return;
    const target = getRangeAnchorElement(range);
    if (!target) return;
    scrollElementIntoContainerView(target, 96);
  }, [setCommentsOpen]);

  const focusThreadById = useCallback(
    (threadId: string) => {
      const thread = sortedThreads.find((candidate) => candidate.id === threadId);
      if (!thread) return false;
      focusThread(thread);
      return true;
    },
    [focusThread, sortedThreads]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const threadId = new URL(window.location.href).searchParams.get("thread");
    if (!threadId || activeThreadId === threadId) return;

    const thread = sortedThreads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      if (!threadsResult.isLoading) {
        updateThreadQueryParam(null);
      }
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!getThreadAnchor(thread)) {
        updateThreadQueryParam(null);
        return;
      }
      if (thread.resolved && !showResolvedThreads) {
        setShowResolvedThreads(true);
      }
      setSidebarMode("comments");
      setCommentsOpen(true);
      focusThread(thread, { syncUrl: false });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeThreadId,
    focusThread,
    setCommentsOpen,
    showResolvedThreads,
    sortedThreads,
    threadsResult.isLoading,
  ]);

  const jumpToHeading = (id: string) => {
    const root = articleRef.current;
    if (!root) return;

    const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    scrollElementIntoContainerView(target, 24);
  };

  const selectionMetadata = pendingSelection
    ? createThreadMetadata({
        anchor: pendingSelection,
        documentSlug,
        documentTitle,
      })
    : undefined;
  const hasDraftSelection =
    sidebarMode === "comments" &&
    pendingSelection !== null &&
    effectiveComposerMode === "selection";
  const commentListItems = useMemo(() => {
    return buildCommentListItems(
      visibleThreads,
      hasDraftSelection ? pendingSelection : null
    );
  }, [hasDraftSelection, pendingSelection, visibleThreads]);

  const sidebarHeader = (
    <div className="flex items-center justify-between border-b border-[var(--sidebar-border)] px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/70 p-0.5">
            <SidebarButton
              variant="tab"
              active={sidebarMode === "comments"}
              onClick={() => toggleSidebarMode("comments")}
            >
              Comments
            </SidebarButton>
            <SidebarButton
              variant="tab"
              active={sidebarMode === "outline"}
              onClick={() => toggleSidebarMode("outline")}
            >
              Outline
            </SidebarButton>
          </div>
          <SidebarButton
            onClick={toggleCommentsPane}
            aria-label="Collapse comments pane"
            className="h-auto w-auto px-2 py-1"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 4 10 8 6 12" />
            </svg>
          </SidebarButton>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            <p>
              {sidebarMode === "comments"
                ? `${visibleThreads.length} ${
                    showResolvedThreads ? "total" : "unresolved"
                  } thread${visibleThreads.length === 1 ? "" : "s"}`
                : `${outlineItems.length} heading${outlineItems.length === 1 ? "" : "s"}`}
            </p>
          </div>
          {sidebarMode === "comments" ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]">
                <span className="sr-only">Comment actions</span>
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
                  <circle cx="3.5" cy="8" r="1" />
                  <circle cx="8" cy="8" r="1" />
                  <circle cx="12.5" cy="8" r="1" />
                </svg>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onClick={() =>
                    setShowResolvedThreads((current) => !current)
                  }
                >
                  {showResolvedThreads ? "Show unresolved only" : "View all threads"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
    </div>
  );

  const sidebarContent = (
    <div className="bg-[var(--background)]/40 p-3">
      <div className="space-y-4">
        {sidebarMode === "comments" && !loadingUser && !canComment ? (
          <CommentSignInPrompt
            context={pendingSelection ? "selection" : "comment"}
          />
        ) : null}

        {sidebarMode === "outline" ? (
          outlineItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--sidebar-border)] px-4 py-6 text-sm text-[var(--text-muted)]">
              No headings found on this page.
            </div>
          ) : (
            <div className="space-y-0.5">
              {outlineItems.map((item) => (
                <OutlineButton
                  key={item.key}
                  item={item}
                  active={item.id === activeHeadingId}
                  ancestor={activeHeadingParentIds.has(item.id)}
                  onClick={() => jumpToHeading(item.id)}
                />
              ))}
            </div>
          )
        ) : commentListItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--sidebar-border)] px-4 py-6 text-sm text-[var(--text-muted)]">
            {threadsResult.error
              ? "Comments are temporarily unavailable."
              : threadsResult.isLoading
                ? "Loading comments…"
                : showResolvedThreads
                    ? "No comments yet."
                    : "No open comments. Switch to View all to see resolved threads."}
          </div>
        ) : (
          <div className="space-y-3">
            {commentListItems.map((item) => {
              if (item.type === "draft-selection") {
                if (!pendingSelection || !canComment) return null;
                return (
                  <DraftSelectionThreadCard
                    key="draft-selection"
                    anchor={pendingSelection}
                    metadata={selectionMetadata}
                    onDismiss={() => {
                      setPendingSelection(null);
                      setSelectionTooltip(null);
                      setComposerMode(null);
                    }}
                  />
                );
              }

              const { thread } = item;
              const anchor = getThreadAnchor(thread);
              const isActive = thread.id === effectiveActiveThreadId;

              return (
                <div
                  key={thread.id}
                  data-comment-list-item="thread"
                  data-thread-id={thread.id}
                  data-anchor-start={anchor?.start}
                  className={cn(
                    "rounded-xl border transition",
                    isActive
                      ? "border-sky-400/70 bg-sky-50/70 dark:border-sky-400/35 dark:bg-sky-500/10"
                      : "border-[var(--sidebar-border)] bg-transparent hover:border-[var(--brand)]/40"
                  )}
                >
                  {anchor ? (
                    <button
                      type="button"
                      onClick={() => focusThread(thread)}
                      className="block w-full border-b border-[var(--sidebar-border)] px-3 py-2 text-left"
                    >
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        Linked selection
                      </p>
                      <p className="line-clamp-3 text-sm text-[var(--foreground)]">
                        {anchor.quote}
                      </p>
                    </button>
                  ) : null}
                  <div
                    className="cursor-pointer px-1 py-1"
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (
                        target.closest(
                          "button, a, input, textarea, [role='menu'], [role='menuitem'], [contenteditable='true']"
                        )
                      ) {
                        return;
                      }
                      focusThread(thread);
                    }}
                  >
                    <Thread
                      thread={thread}
                      commentDropdownItems={({ children, comment }) => {
                        const isFirstComment =
                          thread.comments[0]?.id === comment.id;
                        return (
                          <>
                            {children}
                            {comment.body ? (
                              <Comment.DropdownItem
                                onSelect={() => {
                                  const text = getCommentPlainText(
                                    comment.body
                                  );
                                  if (!text) return;
                                  void navigator.clipboard.writeText(text);
                                }}
                                icon={
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
                                    <rect
                                      x="5"
                                      y="5"
                                      width="8"
                                      height="8"
                                      rx="1.5"
                                    />
                                    <path d="M3.5 10V4.5A1.5 1.5 0 0 1 5 3h5.5" />
                                  </svg>
                                }
                              >
                                Copy comment
                              </Comment.DropdownItem>
                            ) : null}
                            {isFirstComment && canComment ? (
                              <Comment.DropdownItem
                                onSelect={() => {
                                  void (async () => {
                                    const response = await fetch(
                                      "/api/liveblocks-delete-thread",
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          roomId: thread.roomId,
                                          threadId: thread.id,
                                        }),
                                      }
                                    );

                                    if (!response.ok) return;
                                    if (activeThreadId === thread.id) {
                                      updateThreadQueryParam(null);
                                    }
                                    setActiveThreadId((current) => {
                                      if (current === thread.id) {
                                        return null;
                                      }

                                      return current;
                                    });
                                  })();
                                }}
                                icon={
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
                                    <path d="M3 5h10M5.5 5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5M6.5 7.5v4M9.5 7.5v4" />
                                    <path d="M4 5l.5 8a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1L12 5" />
                                  </svg>
                                }
                              >
                                Delete thread
                              </Comment.DropdownItem>
                            ) : null}
                          </>
                        );
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={scrollRootRef} className="h-full overflow-y-auto">
      <div
        className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8 comments-content-wrapper"
        style={{
          ["--comments-pane-width" as string]: commentsOpen
            ? `${commentsWidth}px`
            : `${COMMENTS_COLLAPSED_WIDTH}px`,
          ["--comments-mobile-rail-height" as string]: commentsOpen
            ? "min(52dvh, 30rem)"
            : "3.5rem",
        }}
      >
        <div className="min-w-0 flex-1">
          <article
            ref={articleRef}
            onPointerUp={handlePointerUp}
            onClick={handleArticleClick}
            className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8"
            data-test-id="document-article"
            data-document-slug={documentSlug}
            aria-label={documentTitle}
          >
            <div
              data-comment-highlight-layer
              className="pointer-events-none absolute inset-0 z-0"
            >
              {highlightRects.map((rect) => (
                <div
                  key={rect.id}
                  data-comment-highlight={
                    rect.pending ? "pending" : rect.active ? "active" : "saved"
                  }
                  className={cn(
                    "absolute rounded-[0.35rem]",
                    rect.pending
                      ? "bg-violet-200/55 dark:bg-violet-300/20"
                      : rect.active
                        ? "bg-violet-200/70 dark:bg-violet-300/28"
                        : "bg-violet-200/45 dark:bg-violet-300/18"
                  )}
                  style={{
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))}
            </div>

            {pendingSelection && selectionTooltip && composerMode !== "selection" ? (
              <div
                className="absolute z-30"
                style={{
                  top: selectionTooltip.top,
                  left: selectionTooltip.left,
                }}
              >
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onPointerUp={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSidebarMode("comments");
                    setCommentsOpen(true);
                    if (canComment) {
                      setComposerMode("selection");
                    }
                  }}
                  aria-label="Add comment"
                  title="Add comment"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--sidebar-border)] bg-[var(--card)] text-[var(--text-muted)] shadow-lg transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-10Z" />
                  </svg>
                </button>
              </div>
            ) : null}

            <div data-comment-content className="relative z-10">{children}</div>
          </article>
        </div>
      </div>

      <aside
        data-comments-bottom-rail
        aria-label="Document comments and outline"
        className={cn(
          "fixed inset-x-0 bottom-[calc(3rem+env(safe-area-inset-bottom))] z-40 flex flex-col border-t border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shadow-[0_-12px_28px_rgba(15,23,42,0.14)] transition-[height] duration-200 ease-out md:bottom-0 lg:hidden",
          commentsOpen ? "h-[min(52dvh,30rem)]" : "h-14"
        )}
      >
        {commentsOpen ? (
          <>
            <div className="shrink-0 pt-1">
              <div className="mx-auto mb-1 h-1 w-8 rounded-full bg-[var(--text-muted)]/30" />
              {sidebarHeader}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {sidebarContent}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center gap-2 px-3">
            <div className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/70 p-0.5">
              <SidebarButton
                variant="tab"
                active={sidebarMode === "comments"}
                onClick={() => toggleSidebarMode("comments")}
              >
                Comments
              </SidebarButton>
              <SidebarButton
                variant="tab"
                active={sidebarMode === "outline"}
                onClick={() => toggleSidebarMode("outline")}
              >
                Outline
              </SidebarButton>
            </div>
            <SidebarButton
              onClick={() => setCommentsOpen(true)}
              aria-label="Expand comments rail"
              className="h-auto w-auto px-2 py-1"
            >
              <RailToggleIcon direction="up" />
            </SidebarButton>
          </div>
        )}
      </aside>

      <aside
        className={cn(
          "hidden lg:flex fixed right-0 top-0 bottom-0 z-30 bg-[var(--background)]",
          commentsOpen ? "flex-col shadow-[-4px_0_12px_rgba(0,0,0,0.12)]" : "w-16 flex-col items-center py-3"
        )}
        style={commentsOpen ? { width: commentsWidth } : undefined}
      >
        {commentsOpen ? (
          <>
            <div
              onPointerDown={onCommentsPointerDown}
              onPointerMove={onCommentsPointerMove}
              onPointerUp={onCommentsPointerUp}
              role="separator"
              aria-label="Resize comments pane"
              aria-orientation="vertical"
              className="absolute left-0 top-0 bottom-0 w-[3px] shrink-0 bg-transparent hover:bg-[var(--brand)] active:bg-[var(--brand)] transition-colors cursor-col-resize z-40"
            />
            {sidebarHeader}
            <div className="min-h-0 flex-1 overflow-y-auto">{sidebarContent}</div>
          </>
        ) : (
          <>
            <SidebarButton
              active={sidebarMode === "comments"}
              onClick={() => toggleSidebarMode("comments")}
              aria-label="Open comments"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-10Z" />
              </svg>
            </SidebarButton>
            <SidebarButton
              active={sidebarMode === "outline"}
              onClick={() => toggleSidebarMode("outline")}
              aria-label="Open outline"
              className="mt-2"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4h10M3 8h10M3 12h6" />
              </svg>
            </SidebarButton>
          </>
        )}
      </aside>
    </div>
  );
}

function getRoomId(slug: string) {
  return `markdown:${slug}`;
}

/**
 * Outline-only sidebar shell. Always rendered — provides document outline
 * without any Liveblocks/comments dependency.
 */
export function OutlineShell({
  children,
  documentSlug,
  documentTitle,
  onActivate,
}: {
  children: ReactNode;
  documentSlug?: string;
  documentTitle?: string;
  onActivate?: () => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const { activeHeadingId, outlineItems } = useDocumentOutline(
    articleRef,
    scrollRootRef,
    children
  );
  const activeHeadingParentIds = useMemo(() => {
    return new Set(
      outlineItems.find((item) => item.id === activeHeadingId)?.parentIds ?? []
    );
  }, [activeHeadingId, outlineItems]);
  const {
    open: sidebarOpen,
    setOpen: setSidebarOpen,
    width: sidebarWidth,
    setWidth: setSidebarWidth,
  } = usePersistedPaneState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = sidebarWidth;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [sidebarWidth]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = startX.current - e.clientX;
    const next = Math.min(
      COMMENTS_MAX_WIDTH,
      Math.max(COMMENTS_MIN_WIDTH, startWidth.current + delta)
    );
    setSidebarWidth(next);
  }, [setSidebarWidth]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    const delta = startX.current - e.clientX;
    const next = Math.min(
      COMMENTS_MAX_WIDTH,
      Math.max(COMMENTS_MIN_WIDTH, startWidth.current + delta)
    );
    setSidebarWidth(next, { persist: true });
  }, [setSidebarWidth]);

  const toggleSidebar = () => {
    setSidebarOpen((current) => !current);
  };

  const jumpToHeading = (id: string) => {
    const root = articleRef.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    scrollElementIntoContainerView(target, 24);
  };

  return (
    <div
      ref={scrollRootRef}
      className="h-full overflow-y-auto"
      style={
        {
          "--comments-pane-width": sidebarOpen
            ? `${sidebarWidth}px`
            : `${COMMENTS_COLLAPSED_WIDTH}px`,
          "--comments-mobile-rail-height": sidebarOpen
            ? "min(52dvh, 30rem)"
            : "3.5rem",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-4 md:px-8 md:py-8 comments-content-wrapper">
        <div className="min-w-0 flex-1">
          <article
            ref={articleRef}
            className="relative mx-auto max-w-4xl overflow-visible pr-4 md:pr-8"
            data-test-id="document-article"
            data-document-slug={documentSlug}
            aria-label={documentTitle}
          >
            {children}
          </article>
        </div>
      </div>

      <aside
        data-comments-bottom-rail
        aria-label="Document comments and outline"
        className={cn(
          "hidden",
          sidebarOpen ? "h-[min(52dvh,30rem)]" : "h-14"
        )}
      >
        {sidebarOpen ? (
          <>
            <div className="shrink-0 border-b border-[var(--sidebar-border)] px-3 pb-2 pt-1">
              <div className="mx-auto mb-1 h-1 w-8 rounded-full bg-[var(--text-muted)]/30" />
              {onActivate ? (
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/70 p-0.5">
                    <SidebarButton
                      variant="tab"
                      onClick={onActivate}
                    >
                      Comments
                    </SidebarButton>
                    <SidebarButton
                      variant="tab"
                      active
                      onClick={toggleSidebar}
                    >
                      Outline
                    </SidebarButton>
                  </div>
                  <SidebarButton
                    onClick={toggleSidebar}
                    aria-label="Collapse outline rail"
                    className="h-auto w-auto px-2 py-1"
                  >
                    <RailToggleIcon direction="down" />
                  </SidebarButton>
                </div>
              ) : (
                <div className="mb-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-xs font-medium text-[var(--foreground)]">
                    Outline
                  </span>
                  <SidebarButton
                    onClick={toggleSidebar}
                    aria-label="Collapse outline rail"
                    className="h-auto w-auto px-2 py-1"
                  >
                    <RailToggleIcon direction="down" />
                  </SidebarButton>
                </div>
              )}
              <p className="text-xs text-[var(--text-muted)]">
                {outlineItems.length} heading{outlineItems.length === 1 ? "" : "s"}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--background)]/40 p-3">
              {outlineItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--sidebar-border)] px-4 py-6 text-sm text-[var(--text-muted)]">
                  No headings found on this page.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {outlineItems.map((item) => (
                    <OutlineButton
                      key={item.key}
                      item={item}
                      active={item.id === activeHeadingId}
                      ancestor={activeHeadingParentIds.has(item.id)}
                      onClick={() => jumpToHeading(item.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center gap-2 px-3">
            {onActivate ? (
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/70 p-0.5">
                <SidebarButton
                  variant="tab"
                  onClick={onActivate}
                >
                  Comments
                </SidebarButton>
                <SidebarButton
                  variant="tab"
                  active
                  onClick={() => setSidebarOpen(true)}
                >
                  Outline
                </SidebarButton>
              </div>
            ) : (
              <span className="min-w-0 flex-1 text-sm font-medium text-[var(--foreground)]">
                Outline
              </span>
            )}
            <SidebarButton
              onClick={() => setSidebarOpen(true)}
              aria-label="Expand outline rail"
              className="h-auto w-auto px-2 py-1"
            >
              <RailToggleIcon direction="up" />
            </SidebarButton>
          </div>
        )}
      </aside>

      <aside
        className={cn(
          "hidden lg:flex fixed right-0 top-0 bottom-0 z-30 bg-[var(--background)]",
          sidebarOpen ? "flex-col shadow-[-4px_0_12px_rgba(0,0,0,0.12)]" : "w-16 flex-col items-center py-3"
        )}
        style={sidebarOpen ? { width: sidebarWidth } : undefined}
      >
        {sidebarOpen ? (
          <>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              role="separator"
              aria-label="Resize outline pane"
              aria-orientation="vertical"
              className="absolute left-0 top-0 bottom-0 w-[3px] shrink-0 bg-transparent hover:bg-[var(--brand)] active:bg-[var(--brand)] transition-colors cursor-col-resize z-40"
            />
            <div className="flex items-center justify-between border-b border-[var(--sidebar-border)] px-3 py-2">
              {onActivate ? (
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center rounded-md border border-[var(--sidebar-border)] bg-[var(--background)]/70 p-0.5">
                      <SidebarButton
                        variant="tab"
                        onClick={onActivate}
                      >
                        Comments
                      </SidebarButton>
                      <SidebarButton
                        variant="tab"
                        active
                        onClick={toggleSidebar}
                      >
                        Outline
                      </SidebarButton>
                    </div>
                    <SidebarButton
                      onClick={toggleSidebar}
                      aria-label="Collapse outline pane"
                      className="h-auto w-auto px-2 py-1"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="6 4 10 8 6 12" />
                      </svg>
                    </SidebarButton>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    {outlineItems.length} heading{outlineItems.length === 1 ? "" : "s"}
                  </p>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-xs font-medium text-[var(--foreground)]">Outline</span>
                  <SidebarButton
                    onClick={toggleSidebar}
                    aria-label="Collapse outline pane"
                    className="h-auto w-auto px-2 py-1"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="6 4 10 8 6 12" />
                    </svg>
                  </SidebarButton>
                </>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="bg-[var(--background)]/40 p-3">
                {outlineItems.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--sidebar-border)] px-4 py-6 text-sm text-[var(--text-muted)]">
                    No headings found on this page.
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {outlineItems.map((item) => (
                      <OutlineButton
                        key={item.key}
                        item={item}
                        active={item.id === activeHeadingId}
                        ancestor={activeHeadingParentIds.has(item.id)}
                        onClick={() => jumpToHeading(item.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            {onActivate ? (
              <SidebarButton
                onClick={onActivate}
                aria-label="Open comments"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-3.5 3v-10Z" />
                </svg>
              </SidebarButton>
            ) : null}
            <SidebarButton
              active
              onClick={() => {
                setSidebarOpen(true);
                window.localStorage.setItem(COMMENTS_PANE_STORAGE_KEY, "1");
              }}
              aria-label="Open outline"
              className={cn(onActivate && "mt-2")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 4h10M3 8h10M3 12h6" />
              </svg>
            </SidebarButton>
          </>
        )}
      </aside>
    </div>
  );
}

export const commentsEnabled =
  commentsFeatureEnabled();

export function ActiveDocumentComments({
  documentSlug,
  documentTitle,
  children,
}: {
  documentSlug: string;
  documentTitle: string;
  children: ReactNode;
}) {
  return (
    <LiveblocksRoom
      roomId={getRoomId(documentSlug)}
      fallback={
        <OutlineShell documentSlug={documentSlug} documentTitle={documentTitle}>
          {children}
        </OutlineShell>
      }
    >
      <CommentsShell documentSlug={documentSlug} documentTitle={documentTitle}>
        {children}
      </CommentsShell>
    </LiveblocksRoom>
  );
}

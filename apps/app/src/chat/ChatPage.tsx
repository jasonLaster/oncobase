import { ArchivedChatsCore } from "@oncobase/chat/components/archived-chats-core";
import { ChatInterface } from "@oncobase/chat/components/chat-interface";
import { useChatRuntime } from "@oncobase/chat/runtime";
import { safeSessionStorage } from "@oncobase/safe-storage";
import {
  WikiChatMain,
  WikiChatLoadingSkeleton,
  WikiChatPage,
  WikiChatState,
} from "@oncobase/wiki-shell";
import {
  WikiEditReviewProvider,
  useWikiEditReview,
} from "@oncobase/wiki-shell/wiki-edit-review";
import { useMutation, useQuery } from "convex/react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { useWikiSession } from "../wiki-context";
import { ChatProviders } from "./ChatProviders";

const PANEL_WIDTH_STORAGE_KEY = "oncobase:wiki-edit-panel-width-pct";
const DEFAULT_PANEL_WIDTH_PCT = 58;
const MIN_PANEL_WIDTH_PCT = 38;
const MAX_PANEL_WIDTH_PCT = 72;

// Lazy-loaded so the diff/preview workspace adds 0 bytes to the reader startup
// bundle or to conversations that never open a wiki edit proposal.
const LazyWikiEditReviewPanel = lazy(() =>
  import("@oncobase/wiki-shell/wiki-edit-review-panel").then((module) => ({
    default: module.WikiEditReviewPanel,
  })),
);

function readStoredPanelWidthPct(): number {
  const raw = safeSessionStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_PANEL_WIDTH_PCT;
  return Math.min(MAX_PANEL_WIDTH_PCT, Math.max(MIN_PANEL_WIDTH_PCT, parsed));
}

function ArchivedChatsRoute() {
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const archived = useQuery(api.conversations.listArchived, siteArgs);
  const restoreConversation = useMutation(api.conversations.restore);
  const { copy, routes } = useChatRuntime();

  return (
    <ArchivedChatsCore
      archived={archived}
      copy={copy}
      onRestore={async (conversation) => {
        await restoreConversation({
          id: conversation._id as Id<"conversations">,
          ...siteArgs,
        });
      }}
      renderLink={({ href, children, ...linkProps }) => (
        <Link {...linkProps} to={href}>
          {children}
        </Link>
      )}
      routes={routes}
    />
  );
}

function ChatRouteContent() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const identity = useWikiSession();
  const siteArgs = identity?.siteSlug ? { siteSlug: identity.siteSlug } : {};
  const conversation = useQuery(
    api.conversations.get,
    id && id !== "archived" ? { id, ...siteArgs } : "skip",
  );
  if (id === "archived") {
    return <ArchivedChatsRoute />;
  }
  if (!id) {
    const prompt = searchParams.get("q")?.slice(0, 2000) || undefined;
    return <ChatInterface key={prompt ? `new:${prompt}` : "new"} conversationId={null} initialPrompt={prompt} />;
  }
  if (conversation === undefined) {
    return <WikiChatLoadingSkeleton data-test-id="chat-conversation-loading" />;
  }
  if (conversation === null) {
    return (
      <WikiChatState data-test-id="chat-conversation-not-found">
        Conversation not found
      </WikiChatState>
    );
  }
  return (
    <ChatInterface
      key={id}
      conversationId={id}
      initialMessages={conversation.messages.map((message) => ({
        _id: message._id,
        role: message.role,
        content: message.content,
        parts: message.parts,
        disabled: message.disabled,
      }))}
    />
  );
}

function ChatWorkspace() {
  const { id } = useParams();
  const review = useWikiEditReview();
  const isPanelOpen = Boolean(review?.activeProposalId && review?.activeProposal);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [panelWidthPct, setPanelWidthPct] = useState<number>(readStoredPanelWidthPct);
  const [dragging, setDragging] = useState(false);

  // Close the review panel when switching conversations.
  const closePanel = review?.closePanel;
  useEffect(() => {
    closePanel?.();
  }, [closePanel, id]);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    setDragging(true);
    const rect = container.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      if (rect.width <= 0) return;
      const rightPx = rect.right - moveEvent.clientX;
      const pct = Math.min(
        MAX_PANEL_WIDTH_PCT,
        Math.max(MIN_PANEL_WIDTH_PCT, (rightPx / rect.width) * 100),
      );
      setPanelWidthPct(pct);
      safeSessionStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(pct)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const layoutStyle = isPanelOpen
    ? ({ "--wiki-edit-panel-width": `${panelWidthPct}%` } as CSSProperties)
    : undefined;

  return (
    <div
      ref={containerRef}
      className={`wiki-vite-chat-workspace${isPanelOpen ? " has-review-panel" : ""}${dragging ? " is-resizing" : ""}`}
      style={layoutStyle}
    >
      <WikiChatPage className="wiki-vite-chat-page" data-test-id="chat-page">
        <WikiChatMain>
          <ChatRouteContent />
        </WikiChatMain>
      </WikiChatPage>
      {isPanelOpen ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize wiki edit review panel"
            className="wiki-edit-review-resizer"
            onPointerDown={handleResizeStart}
          />
          <div className="wiki-edit-review-pane">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center border-l border-[var(--sidebar-border)] bg-[var(--background)] text-xs text-[var(--text-muted)]">
                  Loading review panel…
                </div>
              }
            >
              <LazyWikiEditReviewPanel />
            </Suspense>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ChatPage() {
  return (
    <ChatProviders>
      <WikiEditReviewProvider>
        <ChatWorkspace />
      </WikiEditReviewProvider>
    </ChatProviders>
  );
}

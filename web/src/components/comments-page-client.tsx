"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { getCommentPlainText } from "@/lib/liveblocks-comments";

type ServerComment = {
  id: string;
  userId: string;
  createdAt: string;
  body: unknown;
};

type ServerThread = {
  id: string;
  roomId: string;
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  comments: ServerComment[];
  metadata: Record<string, unknown>;
};

type ThreadItem = {
  id: string;
  roomId: string;
  createdAt: Date;
  updatedAt: Date;
  resolved: boolean;
  comments: Array<{
    id: string;
    author: string;
    createdAt: Date;
    text: string;
  }>;
  documentPath: string;
  documentSlug?: string;
  anchorQuote?: string;
};

function formatUserId(userId: string): string {
  if (userId.startsWith("guest_")) return "Guest";
  if (userId === "anonymous") return "Anonymous";
  if (/^[a-z0-9]{32}$/.test(userId)) return "User";
  return userId.length > 20 ? `${userId.slice(0, 12)}...` : userId;
}

function buildThreadItems(
  threads: ServerThread[],
  userNames: Map<string, string>
): ThreadItem[] {
  return threads
    .map((thread) => {
      const metadata = thread.metadata ?? {};
      const latestComment = thread.comments.at(-1);

      return {
        id: thread.id,
        roomId: thread.roomId,
        createdAt: new Date(thread.createdAt),
        updatedAt: new Date(
          latestComment?.createdAt ?? thread.createdAt
        ),
        resolved: thread.resolved,
        comments: thread.comments.map((c) => ({
          id: c.id,
          author:
            userNames.get(c.userId) || formatUserId(c.userId),
          createdAt: new Date(c.createdAt),
          text: getCommentPlainText(c.body),
        })),
        documentPath:
          (metadata.documentSlug as string) ||
          thread.roomId.replace(/^markdown:/, ""),
        documentSlug: metadata.documentSlug as string | undefined,
        anchorQuote: metadata.anchorQuote as string | undefined,
      };
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

function formatRelativeTime(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 1000 * 60 * 60 * 24 * 365],
    ["month", 1000 * 60 * 60 * 24 * 30],
    ["week", 1000 * 60 * 60 * 24 * 7],
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];

  for (const [unit, size] of units) {
    if (absMs >= size) {
      return rtf.format(Math.round(diffMs / size), unit);
    }
  }

  return rtf.format(Math.round(diffMs / 1000), "second");
}

function ReplyComposer({
  roomId,
  threadId,
  onCommentAdded,
}: {
  roomId: string;
  threadId: string;
  onCommentAdded: (comment: { id: string; author: string; createdAt: Date; text: string }) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setSending(true);
      try {
        const res = await fetch("/api/liveblocks-add-comment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            threadId,
            body: trimmed,
          }),
        });
        if (!res.ok) throw new Error("Failed to post reply");
        const data = await res.json();
        setText("");
        onCommentAdded({
          id: data.comment?.id ?? `temp-${Date.now()}`,
          author: "You",
          createdAt: new Date(),
          text: trimmed,
        });
      } catch (err) {
        console.error("Reply failed:", err);
      } finally {
        setSending(false);
      }
    },
    [text, sending, roomId, threadId, onCommentAdded]
  );

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Write a reply..."
        className="flex-1 rounded-lg border border-[var(--sidebar-border)] bg-[var(--background)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
        disabled={sending}
      />
      <button
        type="submit"
        disabled={sending || !text.trim()}
        className="shrink-0 rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white transition-opacity disabled:opacity-40"
      >
        {sending ? "..." : "Reply"}
      </button>
    </form>
  );
}

function ThreadCard({
  item,
  expanded,
  onToggle,
}: {
  item: ThreadItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [comments, setComments] = useState(item.comments);
  const firstComment = comments[0];
  const replies = comments.slice(1);

  const handleCommentAdded = useCallback(
    (comment: { id: string; author: string; createdAt: Date; text: string }) => {
      setComments((prev) => [...prev, comment]);
    },
    []
  );

  return (
    <article className="rounded-2xl border border-[var(--sidebar-border)] bg-[var(--card)] shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{firstComment?.author ?? "Unknown"}</span>
          <time className="text-[var(--text-muted)]">
            {formatRelativeTime(item.createdAt)}
          </time>
          {comments.length > 1 && (
            <span className="text-[var(--text-muted)]">
              {comments.length - 1} repl{comments.length - 1 === 1 ? "y" : "ies"}
            </span>
          )}
          {item.resolved && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Resolved
            </span>
          )}
        </div>
        {item.documentSlug ? (
          <Link
            href={`/${item.documentSlug}`}
            className="shrink-0 text-[var(--brand)] hover:underline"
          >
            {item.documentPath}
          </Link>
        ) : (
          <span className="shrink-0 text-[var(--text-muted)]">{item.documentPath}</span>
        )}
      </div>

      {/* Anchor quote */}
      {item.anchorQuote && (
        <blockquote className="mx-4 mt-3 rounded-lg border border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] px-3 py-2 text-sm text-[var(--text-muted)]">
          {item.anchorQuote}
        </blockquote>
      )}

      {/* First comment body */}
      <div className="px-4 pt-3">
        <p className="whitespace-pre-wrap text-sm leading-6">
          {firstComment?.text || (
            <span className="text-[var(--text-muted)]">Empty comment</span>
          )}
        </p>
      </div>

      {/* Expand/collapse toggle */}
      {(replies.length > 0 || true) && (
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={onToggle}
            className="text-sm text-[var(--brand)] hover:underline"
          >
            {expanded
              ? "Hide replies"
              : replies.length > 0
                ? `Show ${replies.length} repl${replies.length === 1 ? "y" : "ies"}`
                : "Reply"}
          </button>
        </div>
      )}

      {/* Expanded: replies + composer */}
      {expanded && (
        <div className="px-4 pb-4">
          {replies.length > 0 && (
            <div className="mt-3 space-y-3 border-l-2 border-[var(--sidebar-border)] pl-4">
              {replies.map((reply) => (
                <div key={reply.id}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold">{reply.author}</span>
                    <time className="text-[var(--text-muted)]">
                      {formatRelativeTime(reply.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                    {reply.text || (
                      <span className="text-[var(--text-muted)]">Empty comment</span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
          <ReplyComposer
            roomId={item.roomId}
            threadId={item.id}
            onCommentAdded={handleCommentAdded}
          />
        </div>
      )}

      {/* Bottom padding when collapsed */}
      {!expanded && <div className="pb-4" />}
    </article>
  );
}

function CommentsTimeline() {
  const [threads, setThreads] = useState<ServerThread[]>([]);
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolvedThreads, setShowResolvedThreads] = useState(false);
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function loadThreads() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/liveblocks-threads");
        if (!res.ok) throw new Error("Failed to fetch threads");
        const data = await res.json();
        if (cancelled) return;
        setThreads(data.threads ?? []);
        if (data.userNames) {
          setUserNames(new Map(Object.entries(data.userNames)));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load comments");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadThreads();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      showResolvedThreads
        ? threads
        : threads.filter((t) => !t.resolved),
    [showResolvedThreads, threads]
  );

  const items = useMemo(
    () => buildThreadItems(filtered, userNames),
    [filtered, userNames]
  );

  const toggleThread = useCallback((threadId: string) => {
    setExpandedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);

  if (error) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--sidebar-border)] px-6 py-10 text-center text-sm text-[var(--text-muted)]">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setShowResolvedThreads((current) => !current)}
            className="rounded-md border border-[var(--sidebar-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
          >
            {showResolvedThreads ? "Open only" : "View all comments"}
          </button>
        </div>
        <div className="rounded-2xl border border-dashed border-[var(--sidebar-border)] px-6 py-10 text-center text-sm text-[var(--text-muted)]">
          {loading
            ? "Loading comments..."
            : showResolvedThreads
              ? "No comments yet."
              : "No open comments. Switch to view all comments to include resolved threads."}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {loading ? "Loading..." : `${items.length} thread${items.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={() => setShowResolvedThreads((current) => !current)}
          className="rounded-md border border-[var(--sidebar-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--accent-light)] hover:text-[var(--foreground)]"
        >
          {showResolvedThreads ? "Open only" : "View all comments"}
        </button>
      </div>
      {items.map((item) => (
        <ThreadCard
          key={item.id}
          item={item}
          expanded={expandedThreads.has(item.id)}
          onToggle={() => toggleThread(item.id)}
        />
      ))}
    </div>
  );
}

export function CommentsPageClient() {
  return <CommentsTimeline />;
}

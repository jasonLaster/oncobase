/**
 * Convex flusher for /api/chat. Phase 1 of the chat-performance plan.
 *
 * Centralizes all writes to `conversations.streamingText` / `streamingParts`
 * that used to be inline in route.ts. One scheduled tick at FLUSH_INTERVAL_MS
 * coalesces text + tool deltas; finalize() writes the persisted message once
 * and clears the streaming row.
 *
 * PR 28 review: every write carries a runId. Convex mutations reject mismatched
 * runIds so a stale flush from a prior run can never clobber the current one.
 * finalizeAbort clears the matching active run rather than persisting partial
 * assistant text — aborted streams produce no half-written assistant rows.
 *
 * Env override: CHAT_FLUSHER_INTERVAL_MS (default 250). Set to 500 to roll
 * back to the pre-Phase-1 cadence without reverting code.
 */

import type { ChatConvexApi } from "./types";

export type FlusherPart = Record<string, unknown>;

interface SaveMessageInput {
  role: "user" | "assistant";
  content: string;
  parts?: string;
  createdAt: number;
  /** Phase 7: server-generated stable id for idempotent saves. */
  messageId?: string;
}

export interface ConvexFlusher {
  /** Append a streaming text delta. Coalesced and flushed on the next tick. */
  pushText(delta: string): void;
  /** Append a tool-call part. Flushed on the next tick (no immediate write). */
  pushToolCall(part: FlusherPart): void;
  /** Update an existing tool part with a result. Flushed on the next tick. */
  updateToolResult(toolCallId: string, output: unknown): void;
  /** Final: save the assistant message + clear streaming row, both runId-guarded. */
  finalize(messages: SaveMessageInput[]): Promise<void>;
  /** Error path: write error as streaming text, save as assistant message, clear. */
  finalizeError(message: string, errorMessageId?: string): Promise<void>;
  /** Abort path: cancel pending timer + clear streaming row. Does NOT persist
   *  partial assistant text — aborted streams clear the matching active run. */
  finalizeAbort(): Promise<void>;
  /** Snapshot of the current accumulated text (used by abort handling). */
  getCurrentText(): string;
  /** Snapshot of the current accumulated parts (used by error handling). */
  getCurrentParts(): FlusherPart[];
}

interface CreateOptions {
  convex: {
    mutation: (ref: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  conversations: ChatConvexApi["conversations"];
  conversationId?: string;
  /** runId for this turn. Convex mutations reject mismatched runIds. */
  runId?: string;
  /** Active site slug for multi-tenant scoping. Threaded into every
   * Convex mutation so the underlying conversations row is verified
   * to belong to this site before being patched. */
  siteSlug?: string;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = Number(
  process.env.CHAT_FLUSHER_INTERVAL_MS ?? 250
);

export function createConvexFlusher({
  convex,
  conversations,
  conversationId,
  runId,
  siteSlug,
  intervalMs = DEFAULT_INTERVAL_MS,
}: CreateOptions): ConvexFlusher {
  let currentText = "";
  const parts: FlusherPart[] = [];
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finalized = false;

  function cancelTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function flushNow(): Promise<void> {
    if (!conversationId) return Promise.resolve();
    cancelTimer();
    if (!dirty) return Promise.resolve();
    dirty = false;
    return convex
      .mutation(conversations.updateStreaming, {
        conversationId,
        runId,
        siteSlug,
        text: currentText,
        // Phase 2: parts column is union(string, array). We always write the
        // native array form. The schema validator accepts both for backward
        // compat with rows that pre-date the migration.
        parts: parts as unknown as string,
      })
      .then(
        () => undefined,
        () => undefined // best-effort
      );
  }

  function schedule() {
    if (!conversationId || finalized) return;
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flushNow();
    }, intervalMs);
  }

  return {
    pushText(delta) {
      currentText += delta;
      const last = parts[parts.length - 1];
      if (last && last.type === "text") {
        last.text = (last.text as string) + delta;
      } else {
        parts.push({ type: "text", text: delta });
      }
      schedule();
    },
    pushToolCall(part) {
      parts.push(part);
      schedule();
    },
    updateToolResult(toolCallId, output) {
      const part = parts.find((p) => p.toolCallId === toolCallId);
      if (!part) return;
      part.output = output;
      part.state = "output-available";
      schedule();
    },
    async finalize(messages) {
      if (finalized || !conversationId) {
        finalized = true;
        return;
      }
      finalized = true;
      cancelTimer();
      try {
        if (messages.length > 0) {
          await convex.mutation(conversations.saveMessages, {
            conversationId,
            runId,
            siteSlug,
            messages,
          });
        }
        await convex.mutation(conversations.clearStreaming, {
          conversationId,
          runId,
          siteSlug,
        });
      } catch {
        // Best-effort. The 30s stale-stream watchdog on the client clears
        // the row if we somehow leave it dirty.
      }
    },
    async finalizeError(message, errorMessageId) {
      if (finalized || !conversationId) {
        finalized = true;
        return;
      }
      finalized = true;
      cancelTimer();
      try {
        const errorParts = [{ type: "text" as const, text: message }];
        await convex.mutation(conversations.updateStreaming, {
          conversationId,
          runId,
          siteSlug,
          text: message,
          parts: errorParts as unknown as string,
        });
        await convex.mutation(conversations.saveMessages, {
          conversationId,
          runId,
          siteSlug,
          messages: [
            {
              role: "assistant",
              content: message,
              parts: errorParts as unknown as string,
              createdAt: Date.now(),
              messageId: errorMessageId,
            },
          ],
        });
        await convex.mutation(conversations.clearStreaming, {
          conversationId,
          runId,
          siteSlug,
        });
      } catch {
        // Best-effort.
      }
    },
    /**
     * Abort path: cancel the pending flush timer and clear the streaming row,
     * runId-guarded. Per the spec, aborted streams must clear the matching
     * active run rather than save partial assistant text — a half-finished
     * row would be indistinguishable from a completed response in the UI.
     */
    async finalizeAbort() {
      if (finalized || !conversationId) {
        finalized = true;
        return;
      }
      finalized = true;
      cancelTimer();
      try {
        await convex.mutation(conversations.clearStreaming, {
          conversationId,
          runId,
          siteSlug,
        });
      } catch {
        // Best-effort.
      }
    },
    getCurrentText: () => currentText,
    getCurrentParts: () => parts,
  };
}

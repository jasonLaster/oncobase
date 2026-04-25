/**
 * Convex flusher for /api/chat. Phase 1 of the chat-performance plan.
 *
 * Centralizes all writes to `conversations.streamingText` / `streamingParts`
 * that used to be inline in route.ts. One scheduled tick at FLUSH_INTERVAL_MS
 * coalesces text + tool deltas; finalize() writes the persisted message once
 * and clears the streaming row.
 *
 * Today the row stays a JSON-encoded string (Phase 2 turns it into a native
 * array). The flusher's interface is shaped so Phase 2 only changes the
 * serialization, not the call sites.
 *
 * Env override: CHAT_FLUSHER_INTERVAL_MS (default 250). Set to 500 to roll
 * back to the pre-Phase-1 cadence without reverting code.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export type FlusherPart = Record<string, unknown>;

interface SaveMessageInput {
  role: "user" | "assistant";
  content: string;
  parts?: string;
  createdAt: number;
}

export interface ConvexFlusher {
  /** Append a streaming text delta. Coalesced and flushed on the next tick. */
  pushText(delta: string): void;
  /** Append a tool-call part. Flushed on the next tick (no immediate write). */
  pushToolCall(part: FlusherPart): void;
  /** Update an existing tool part with a result. Flushed on the next tick. */
  updateToolResult(toolCallId: string, output: unknown): void;
  /**
   * Save the final assistant message and clear the streaming row.
   * Idempotent for our purposes: if invoked twice, the second call is a no-op.
   */
  finalize(messages: SaveMessageInput[]): Promise<void>;
  /** Mark the stream as failed; write a one-line error and clear. */
  finalizeError(message: string): Promise<void>;
  /** Save partial text on abort and clear the streaming row. */
  finalizeAbort(): Promise<void>;
  /** Snapshot of the current accumulated text (used by abort handling). */
  getCurrentText(): string;
  /** Snapshot of the current accumulated parts (used by error handling). */
  getCurrentParts(): FlusherPart[];
}

interface CreateOptions {
  convex: ConvexHttpClient;
  conversationId?: Id<"conversations">;
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = Number(
  process.env.CHAT_FLUSHER_INTERVAL_MS ?? 250
);

export function createConvexFlusher({
  convex,
  conversationId,
  intervalMs = DEFAULT_INTERVAL_MS,
}: CreateOptions): ConvexFlusher {
  let currentText = "";
  const parts: FlusherPart[] = [];
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finalized = false;

  function flushNow(): Promise<void> {
    if (!conversationId) return Promise.resolve();
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return Promise.resolve();
    dirty = false;
    return convex
      .mutation(api.conversations.updateStreaming, {
        conversationId,
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
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        if (messages.length > 0) {
          await convex.mutation(api.conversations.saveMessages, {
            conversationId,
            messages,
          });
        }
        await convex.mutation(api.conversations.clearStreaming, {
          conversationId,
        });
      } catch {
        // Best-effort. The 30s stale-stream watchdog on the client clears
        // the row if we somehow leave it dirty.
      }
    },
    async finalizeError(message) {
      if (finalized || !conversationId) {
        finalized = true;
        return;
      }
      finalized = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        const errorParts = [{ type: "text" as const, text: message }];
        // Surface the error as streaming text so the client sees it before
        // we clear, then save it as the assistant message and clear.
        await convex.mutation(api.conversations.updateStreaming, {
          conversationId,
          text: message,
          parts: errorParts as unknown as string,
        });
        await convex.mutation(api.conversations.saveMessages, {
          conversationId,
          messages: [
            {
              role: "assistant",
              content: message,
              parts: errorParts as unknown as string,
              createdAt: Date.now(),
            },
          ],
        });
        await convex.mutation(api.conversations.clearStreaming, {
          conversationId,
        });
      } catch {
        // Best-effort.
      }
    },
    async finalizeAbort() {
      if (finalized || !conversationId) {
        finalized = true;
        return;
      }
      finalized = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      try {
        const ops: Array<Promise<unknown>> = [
          convex.mutation(api.conversations.clearStreaming, {
            conversationId,
          }),
        ];
        if (currentText) {
          ops.push(
            convex.mutation(api.conversations.saveMessages, {
              conversationId,
              messages: [
                {
                  role: "assistant",
                  content: currentText,
                  createdAt: Date.now(),
                },
              ],
            })
          );
        }
        await Promise.all(ops);
      } catch {
        // Best-effort.
      }
    },
    getCurrentText: () => currentText,
    getCurrentParts: () => parts,
  };
}

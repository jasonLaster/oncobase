/**
 * Chat performance instrumentation. Phase 0 of the chat-performance plan.
 *
 * Records first-token latency, tokens/sec on the wire, React commits/sec, and
 * stale-stream events. Dev mode logs to console; prod is sampled and emitted
 * via `window.__CHAT_PERF__` for an external sink (Playwright reads it).
 *
 * Host apps can read `window.__CHAT_PERF__` from Playwright or their own
 * telemetry bridge.
 */

export type ChatPerfEvent =
  | { type: "submit"; t: number; conversationId: string | null }
  | { type: "first-token"; t: number; conversationId: string | null; latencyMs: number }
  | { type: "stream-tick"; t: number; bytes: number; tokensApprox: number }
  | { type: "stream-end"; t: number; totalMs: number; totalBytes: number }
  | { type: "stale-stream"; t: number; ageMs: number }
  | { type: "abort"; t: number; reason: "user" | "error" | "timeout" }
  | { type: "render"; t: number; component: "chat" | "messages" | "streaming" };

export interface ChatPerfBuffer {
  events: ChatPerfEvent[];
  push: (e: ChatPerfEvent) => void;
  drain: () => ChatPerfEvent[];
  clear: () => void;
}

const MAX_EVENTS = 2000;

function createBuffer(): ChatPerfBuffer {
  const events: ChatPerfEvent[] = [];
  return {
    events,
    push(e) {
      events.push(e);
      if (events.length > MAX_EVENTS) events.shift();
    },
    drain() {
      const copy = events.slice();
      events.length = 0;
      return copy;
    },
    clear() {
      events.length = 0;
    },
  };
}

declare global {
  interface Window {
    __CHAT_PERF__?: ChatPerfBuffer;
  }
}

function getBuffer(): ChatPerfBuffer | null {
  if (typeof window === "undefined") return null;
  if (!window.__CHAT_PERF__) window.__CHAT_PERF__ = createBuffer();
  return window.__CHAT_PERF__;
}

const DEV = process.env.NODE_ENV === "development";
const FLAG_ENABLED =
  DEV ||
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CHAT_PERF === "1");

/**
 * Recording is enabled if any of:
 *   - dev mode
 *   - NEXT_PUBLIC_CHAT_PERF=1 at build time
 *   - the page injected `window.__CHAT_PERF__` before mount (e.g. Playwright
 *     `addInitScript`). The presence of the buffer is itself an opt-in.
 */
export function recordChatPerf(event: ChatPerfEvent): void {
  if (typeof window === "undefined") return;
  const preInjected = window.__CHAT_PERF__ !== undefined;
  if (!FLAG_ENABLED && !preInjected) return;
  const buf = getBuffer();
  if (!buf) return;
  buf.push(event);
  if (DEV && (event.type === "first-token" || event.type === "stream-end")) {
    console.debug(`[chat-perf] ${event.type}`, event);
  }
}

/** Mark and return a labelled time. Cheap; uses performance.now(). */
export function nowMs(): number {
  if (typeof performance !== "undefined") return performance.now();
  return Date.now();
}

/**
 * Track first-token latency from a submit moment. Returns a `tick(bytes)`
 * function that records the *first* call as the first-token event and
 * subsequent calls as stream-tick samples. Call `end()` on completion or abort.
 */
export function trackStream(opts: {
  conversationId: string | null;
  submitT: number;
}): {
  tick: (bytes: number) => void;
  end: (reason?: "ok" | "abort" | "error") => void;
} {
  let firstSeen = false;
  let totalBytes = 0;
  return {
    tick(bytes) {
      totalBytes += bytes;
      const t = nowMs();
      if (!firstSeen) {
        firstSeen = true;
        recordChatPerf({
          type: "first-token",
          t,
          conversationId: opts.conversationId,
          latencyMs: t - opts.submitT,
        });
      }
      recordChatPerf({
        type: "stream-tick",
        t,
        bytes,
        // ~4 chars/token rule-of-thumb
        tokensApprox: Math.max(1, Math.round(bytes / 4)),
      });
    },
    end(reason = "ok") {
      const t = nowMs();
      if (reason === "abort") {
        recordChatPerf({ type: "abort", t, reason: "user" });
      } else if (reason === "error") {
        recordChatPerf({ type: "abort", t, reason: "error" });
      } else {
        recordChatPerf({
          type: "stream-end",
          t,
          totalMs: t - opts.submitT,
          totalBytes,
        });
      }
    },
  };
}

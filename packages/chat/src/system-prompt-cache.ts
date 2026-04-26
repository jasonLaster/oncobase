/**
 * Memoizes the chat system prompt. Phase 7 of the chat-performance plan.
 *
 * Prompt context is often shared across chat turns. Caching the assembled
 * prompt for 60s lets the host app avoid repeating expensive reads during a
 * hot conversation.
 *
 * Cache key is intentionally global (no conversationId) — the prompt does
 * not depend on the conversation. Per-conversation overrides would key
 * differently if they exist later.
 */

const TTL_MS = Number(process.env.CHAT_SYSTEM_PROMPT_TTL_MS ?? 60_000);

interface CacheEntry {
  prompt: string;
  ts: number;
}

let cached: CacheEntry | null = null;
let inFlight: Promise<string> | null = null;

/**
 * Returns the cached prompt if fresh; otherwise calls `loader` exactly once
 * and caches its result. Concurrent callers share a single in-flight promise.
 */
export async function getCachedSystemPrompt(
  loader: () => Promise<string>
): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.ts < TTL_MS) {
    return cached.prompt;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const prompt = await loader();
      cached = { prompt, ts: Date.now() };
      return prompt;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test / debug only. */
export function _resetSystemPromptCache(): void {
  cached = null;
  inFlight = null;
}

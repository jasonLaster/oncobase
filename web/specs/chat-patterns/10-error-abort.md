# Error / Abort / Disconnect

Three distinct conditions that must look and behave differently in the UI.

## The three conditions

```
                ┌──────────────────────────────────────┐
                │ Stream alive, model producing tokens │
                └─────────────┬────────────────────────┘
                              │
       ┌──────────────────────┼─────────────────────────┐
       │                      │                         │
       ▼                      ▼                         ▼
┌─────────────┐         ┌─────────────┐          ┌─────────────┐
│   error     │         │   abort     │          │ disconnect  │
│ (model failed,│       │(user clicked │         │(network drop,│
│ tool threw, │         │ Stop)       │          │ tab closed) │
│ provider 5xx)│        │             │          │             │
└─────────────┘         └─────────────┘          └─────────────┘
       │                      │                         │
   show error            show partial             reconnect / replay
   inline + retry        + greyed-out             buffered stream
```

The mistake every chat app makes at least once: treating disconnect as an error. It isn't. The user just lost their network for a second; the model is still running.

## How AI SDK distinguishes

`~/src/os/vercel-ai/packages/ai/src/ui/chat.ts:664–755`

```ts
// In processUIMessageStream, the abort signal listener:
const onAbort = () => { isAbort = true; };
abortController.signal.addEventListener('abort', onAbort);

// onFinish callback receives the disambiguated reasons:
onFinish?.(message, {
  isAbort,        // true if the user fired stop() — distinct from error
  isDisconnect,   // true if the network/transport dropped
  isError,        // true if the model/tool/route threw
  finishReason,   // 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'other'
});
```

In useChat, status flips:
- `'streaming' → 'ready'` on natural finish or stop()
- `'streaming' → 'error'` on error
- (transport handles disconnect internally via reconnect)

## TanStack's deduplicated error reporting

`~/src/os/tanstack-ai/packages/typescript/ai-client/src/chat-client.ts:~380–420`

```ts
private reportStreamError(error: Error): void {
  const alreadyReported = this.errorReportedGeneration === this.streamGeneration;
  this.setError(error);
  if (this.isLoading || this.status === 'submitted' || this.status === 'streaming') {
    this.setStatus('error');
  }
  if (!alreadyReported) {
    this.errorReportedGeneration = this.streamGeneration;
    this.callbacksRef.current.onError(error);
  }
}
```

`streamGeneration` increments on every new `sendMessage`. The dedupe ensures `onError` fires *once per generation* — important because some errors (network) bubble through multiple layers.

## Codex's TurnAborted reasons

`~/src/os/codex/codex-rs/protocol/src/protocol.rs:2100–2150`

```rust
pub struct TurnAbortedEvent {
    pub reason: TurnAbortReason,
    pub turn_id: Option<String>,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
}

pub enum TurnAbortReason {
    Interrupted,           // user fired Stop
    Error,                 // server-side error
    ContextLimitExceeded,  // hit the model's context window
    NetworkError,          // provider connection failure
}

pub enum ReviewDecision {
    Approved, Denied, TimedOut,
    Abort,  // user-triggered abort during approval
}
```

The reason field tells the UI what to show:
- `Interrupted`: greyed-out partial, no error styling. "Stopped."
- `Error`: red error block, retry button. "Something went wrong: …"
- `ContextLimitExceeded`: special UX — offer to summarize/compact and retry. "Conversation too long; compact and retry?"
- `NetworkError`: same as Error but explicitly retry-eligible.

This is more granular than what AI SDK emits. We can fold it into our error handler.

## Retry strategies

TanStack offers no built-in retry; you wrap `sendMessage` yourself:

```ts
const sendWithRetry = async (msg: string, maxRetries = 3) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await sendMessage(msg);
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); // exp backoff
    }
  }
};
```

vercel/ai-chatbot's pattern:
- 5xx → retry once with 1s backoff (transparent to user).
- After that, surface to user with "Retry" button (no auto-retry).
- 4xx (auth, credits, validation) → never retry; surface immediately.

Don't auto-retry models that are running into context-limit or content-filter errors. Those need user intervention.

## Sonner toasts for transient errors

shadcn `<Toaster>`:

```ts
import { toast } from 'sonner';

toast.error('Connection lost', {
  description: 'Reconnecting…',
  // No action; auto-dismisses when reconnected
});

toast.error('Out of credits', {
  description: 'Check your AI Gateway usage.',
  action: { label: 'Open Vercel', onClick: () => window.open('https://vercel.com/...') },
});
```

Use toasts for transient/recoverable conditions. Use inline error blocks (in the message list) for permanent ones (the model said no).

## Stop semantics — what should happen

When the user clicks Stop:

1. **Client**: `useChat.stop()` aborts the local SSE fetch. Status flips to `ready`.
2. **Server (current)**: `req.signal` fires (because the client disconnected the SSE). `onAbort` callback runs. Flusher persists partial text + clears the streaming row. **But the model continues running** because the abort signal we passed to streamText is `req.signal`, and that fires only when the client disconnects — which IS what happened, so the model also stops.

Wait — is that what we want? Yes for stop-button-clicked. No for navigation-resilience. Same signal can't serve both purposes.

The fix:
- Use **two signals**: `userStopSignal` (only fires when the user explicitly clicks stop, via a `canceledAt` flag the route polls) and the implicit transport-level disconnect (which closes the SSE but doesn't abort streamText).
- The user clicks Stop → mutation sets `conversation.canceledAt = Date.now()`.
- The route's `onChunk` (throttled) reads `canceledAt`. If set, calls `userStopSignal.abort()`.
- Model stops. `onAbort` runs. Flusher saves partial. Convex mutation clears `canceledAt` and `streamingParts`.

This split is what enables both:
- **Stop button** → model halts immediately (client + server-canceled flag both fire).
- **Navigation away** → model continues; resumable stream context buffers; user sees full message on return.

## What our chat does

`web/src/app/(main)/chat/_components/chat-interface.tsx`:
- `handleStop()` calls `stop()` from useChat (aborts SSE) + `clearStreamingMutation` (Convex) + `disableLastUserMessage` (mark with strikethrough).
- The route's `streamText` uses `req.signal` (implicitly via `streamText`'s default) — actually we don't pass an explicit `abortSignal`, so it follows the request lifecycle.

`web/src/app/api/chat/route.ts`:
- `onAbort: async () => flusher.finalizeAbort();` — handles partial save.
- `onError: ...` — distinguishes auth/credits errors with custom messages, calls `flusher.finalizeError(userMsg, errorMessageId)`.
- `onFinish: ...` — happy path; saves the message, clears streaming row.

We have the right shape for *errors*. We don't yet have the **disconnect-vs-stop split**.

## What to add

1. **Two-signal abort.** Replace `req.signal` with an explicit `userStopSignal` derived from `canceledAt`. The route polls it via throttled `onChunk`. Disconnect (request close) no longer aborts the model; only an explicit user stop does.

2. **Toast for recoverable errors.** Network blips, transient 5xx → toast. Auth/credits/content-filter → inline.

3. **Retry button on error blocks.** Today the inline error is read-only. Add a "Retry" affordance that fires `regenerate()` or re-fires the last user message.

4. **Better error reasons.** The route returns `{ error: "..." }` JSON for non-2xx. Add a typed `code` field (`"auth"` | `"credits"` | `"validation"` | `"context-limit"` | `"server-error"`) so the client renders different UX per code.

5. **Context-limit special case.** When the model returns "context length exceeded", offer "Compact this conversation and retry" inline — calls a server-side compaction routine that summarizes the first N turns into a single system message, then retries.

## Top patterns to steal

| Pattern                                                 | From         |
| ------------------------------------------------------- | ------------ |
| `{ isAbort, isDisconnect, isError }` distinction        | vercel/ai    |
| Two-signal abort (user stop vs request close)           | vercel/ai    |
| Deduped `onError` per generation                        | TanStack     |
| `TurnAbortReason` enum (interrupt/error/context/network)| codex        |
| Sonner toasts for transient, inline blocks for permanent | shadcn      |
| Retry button on error blocks                            | (recommended)|
| Special context-limit handler with compact-and-retry    | codex        |
| Typed `code` on error responses                         | (recommended)|

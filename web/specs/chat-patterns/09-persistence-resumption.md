# Persistence + Resumption (Navigation Resilience)

**This is the load-bearing constraint of our chat: the server runs to completion regardless of whether the client is connected.** A user can submit a question, navigate to another wiki page, navigate back, and see the assistant message that landed while they were away.

Every reference repo upholds this in some form. The patterns differ in *where* the durable state lives and *how* the client picks it back up.

## The four canonical patterns

| Pattern                                              | Storage              | Stream replay      | Fits our stack    |
| ---------------------------------------------------- | -------------------- | ------------------ | ----------------- |
| Convex mirror + onFinish save                        | Convex `streamingParts` + `messages` | Convex reactive query | ✓ (current)       |
| createResumableStreamContext                         | In-memory + waitUntil | Server replays SSE | ✓ (additive)      |
| Event-sourced log + projection reads                 | SQLite events table  | Replay events from log | (heavier)     |
| thread_id replay from DB                             | DB threads + turns   | Re-fetch on mount  | ✓ (we already do this for messages) |

We already use **Convex mirror** as the primary durability layer. Add **createResumableStreamContext** so the active SSE stream itself is replayable too — the UX win is that a reconnecting client picks up the *exact* tokens it missed, not just the latest "snapshot from Convex".

## createResumableStreamContext — the canonical Vercel pattern

`~/src/os/vercel-ai/examples/next/app/api/chat/route.ts:60–99`

```ts
import { createResumableStreamContext } from '@vercel/functions';
import { after } from 'next/server';

export async function POST(req: Request) {
  const { messages, id, trigger, messageId } = await req.json();
  const userStopSignal = new AbortController();
  const streamId = generateId();

  const result = streamText({
    model,
    messages,
    abortSignal: userStopSignal.signal,
    onChunk: throttle(async () => {
      const { canceledAt } = await readChat(id);
      if (canceledAt) userStopSignal.abort();
    }, 1000),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    generateMessageId: generateId,
    onFinish: ({ messages }) => saveChat({ id, messages, activeStreamId: null }),
    consumeSseStream: async ({ stream }) => {
      const ctx = createResumableStreamContext({ waitUntil: after });
      await ctx.createNewResumableStream(streamId, () => stream);
      saveChat({ id, activeStreamId: streamId });
    },
  });
}

export async function GET(req: Request) {
  // Reconnect endpoint: client passes ?id= to resume
  const { id } = parseUrl(req.url);
  const chat = await readChat(id);
  if (!chat.activeStreamId) return new Response(null, { status: 204 });

  const ctx = createResumableStreamContext({ waitUntil: after });
  const stream = await ctx.resumeExistingStream(chat.activeStreamId);
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', ... },
  });
}
```

How it works:
1. `consumeSseStream` is called once when the response starts. The callback registers the SSE stream with a `streamId`. The stream is buffered server-side (in memory or Redis) keyed by the id.
2. `waitUntil(after)` keeps the function alive past the response so the buffer can be filled even after the client disconnects.
3. On reconnect, the GET endpoint reads the active stream id from the chat and asks the resumable context for that stream's *replay*. The client sees the exact bytes from the start (or from where it left off, depending on the implementation).
4. On finish, `activeStreamId` is cleared. New connections see "no stream" and load history instead.

What changes on the client:
- `useChat({ id, resume: true })` — the `resume: true` flag tells the hook to call `transport.reconnectToStream()` on mount. Internally this hits the GET endpoint above and replays the buffered stream.

## How navigation resilience plays out

```
   ┌─────────────────────────────────────────────────────────────┐
   │ User on /chat/abc                                           │
   │                                                             │
   │  submit → POST /api/chat (id=abc, messages=[...])           │
   │  └── server starts streamText                               │
   │      ├── consumeSseStream registers streamId, saves         │
   │      │   chat.activeStreamId = streamId                     │
   │      ├── onChunk → flusher writes to Convex mirror          │
   │      └── (response is being read by client over SSE)        │
   │                                                             │
   │  user navigates to /wiki/foo (closes the SSE)               │
   │      ├── server's streamText continues — abortSignal not    │
   │      │   tied to the response; waitUntil keeps the function │
   │      │   alive                                              │
   │      ├── flusher keeps writing to Convex mirror             │
   │      └── onFinish: saves messages, clears activeStreamId    │
   │                                                             │
   │  user navigates back to /chat/abc                           │
   │      ├── page mounts                                        │
   │      ├── Convex query returns messages array (now complete) │
   │      ├── useChat({ resume: true }) calls reconnectToStream  │
   │      │   ├── if activeStreamId set: replay buffered stream  │
   │      │   └── if not: 204; client just shows the saved msgs  │
   │      └── user sees the assistant message that landed        │
   │                                                             │
   └─────────────────────────────────────────────────────────────┘
```

Critical: `streamText`'s abort signal must NOT be tied to `req.signal` (which fires when the client disconnects). Use a separate `AbortController` you can fire on user-explicit cancel only. The Vercel example above uses `userStopSignal.signal` for exactly this.

## Server-generated message IDs

`~/src/os/vercel-ai/packages/ai/src/agent/`

```ts
import { createIdGenerator } from 'ai';

const generateMessageId = createIdGenerator({ prefix: 'msg', size: 16 });

return result.toUIMessageStreamResponse({
  generateMessageId,                  // assigned to the assistant message
  originalMessages: messages,         // tracks user messages so saved IDs are stable
  onFinish: ({ messages }) => saveChat({ id, messages }),
});
```

Client never invents persisted ids. This is what makes idempotency work: if `saveChat` runs twice (retry, double-mount), the (`conversationId`, `messageId`) uniqueness check skips the second insert.

## Convex mirror — what we have

`web/src/app/api/chat/_flusher.ts`:
- `pushText(delta)` — accumulates text, schedules a 250ms flush.
- `pushToolCall(part)` / `updateToolResult(id, output)` — same.
- `finalize(messages)` — single-flight write of the persisted assistant message + clear streaming row.
- `finalizeError(message, errorMessageId)` — error path.
- `finalizeAbort()` — partial-text persistence.

Convex `conversations.streamingParts` holds the live stream snapshot; reactive queries on the client pick it up. This is *also* what gives us cross-tab sync (see [12-multi-tab-cross-window.md](./12-multi-tab-cross-window.md)).

## Codex's thread persistence

`~/src/os/codex/sdk/typescript/src/thread.ts:40–100`

```ts
class Thread {
  async runStreamed(input: Input, opts: TurnOptions): Promise<StreamedTurn> {
    return this._exec.run({ threadId: this._id, input, ... });
  }
}

type ThreadStartedEvent = { type: 'thread.started'; thread_id: string };
```

Thread id returned in the first event. Client persists it. On reconnect, pass back; server replays from DB. This is the same pattern as the Vercel resumable-stream-context, but with the thread id as the key (not a generated stream id).

Codex turns are not resumable: once aborted, that turn is closed; new turn = fresh request. Threads are.

## t3code's event log + projections

`~/src/os/t3code/apps/server/src/persistence/Migrations/001_OrchestrationEvents.ts:7–23`

```sql
CREATE TABLE orchestration_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE,
  aggregate_kind TEXT,
  stream_id TEXT,
  stream_version INT,
  event_type TEXT,
  occurred_at TEXT,
  command_id TEXT,
  payload_json TEXT,
  metadata_json TEXT
);
```

Every state change is an immutable event. The shell-stream and detail-stream views are projections (built by replaying the relevant subset of events). On reconnect, the client subscribes to events with `since: lastSequence`. The server replays everything missed.

This is the most robust persistence model — it's literally event sourcing — and the heaviest. We don't need it for our chat. The Convex mirror approximates it (each `updateStreaming` mutation is effectively an event; the `messages` table is a projection of "what was committed").

## What our chat does — and the gap

✓ Convex mirror writes via `_flusher.ts` survive client disconnect.
✓ `messages` table is the canonical history; loaded on mount via Convex `useQuery(api.conversations.get)`.
✓ `onFinish` persists the assistant message exactly once.
✓ Server-generated `messageId` for idempotency.
✓ 30s stale-stream watchdog clears orphan streaming rows.

✗ The active SSE stream is **not resumable** end-to-end. If the user reconnects mid-stream, they see the Convex mirror snapshot (250ms-stale) but they don't see the exact tokens that came *after* their disconnect arrived in real time. They poll Convex.

✗ `streamText` is bound to the request's lifecycle. When the user navigates away, the response stream closes; the route function is killed by the runtime when the response is done writing. Our flusher writes the partial state to Convex and clears it via `finalizeAbort` when `onAbort` fires.

✗ `waitUntil()` is not in use, so there's no guarantee the function survives past the client's disconnect.

## What to add

This is the single highest-impact server-side improvement:

1. **Wrap `streamText` in `createResumableStreamContext` + `waitUntil(after)`.** The route function survives client disconnect; the SSE stream is buffered and replayable; the model continues running.

2. **Decouple `streamText`'s abort from `req.signal`.** Use a separate `userStopSignal` driven by an explicit "stop" mutation on the conversation (`canceledAt`). The route polls this every chunk (throttled to 1s) and aborts the model when it flips. Today we abort on `req.signal` which fires on *any* disconnect — that's wrong for navigation resilience.

3. **Add a GET `/api/chat?id=…` reconnect endpoint** that reads `activeStreamId` and replays via the resumable context.

4. **Pass `resume: true` to useChat** so on every mount the client tries to reconnect to a buffered stream. If 204, it falls through to the Convex mirror (which is what we already do).

5. **Persist `activeStreamId` on the conversation row.** Simple new column. Cleared on `onFinish` and `finalizeError`.

After this, the user can:
- Submit and navigate away → server completes, message saved.
- Submit and refresh → client reconnects to the buffered stream, sees the exact tokens.
- Open the same conversation in a second tab → second tab also reconnects to the same buffered stream.
- Server crashes → 30s watchdog clears the row; user sees a "we lost the response, retry?" affordance.

## Top patterns to steal

| Pattern                                              | From          |
| ---------------------------------------------------- | ------------- |
| `createResumableStreamContext` + `consumeSseStream`  | vercel/ai     |
| `waitUntil(after)` keeps the function alive          | vercel/ai     |
| Decouple abort signal from `req.signal`              | vercel/ai     |
| `userStopSignal` + DB-polled cancel flag             | vercel/ai     |
| Server-generated `messageId` for idempotent saves    | vercel/ai     |
| `activeStreamId` column for reconnect routing        | vercel/ai     |
| Reactive mirror (Convex) for cross-tab + recovery    | t3code        |
| `thread_id` persistence + replay on reconnect        | codex         |
| Event-sourced log (heavy; for future)                | t3code        |
| 30s stale-stream watchdog                            | (us, keeps)   |

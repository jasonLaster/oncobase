# Multi-Tab + Cross-Window Sync

When the user has the same conversation open in two tabs (or two devices), what do they see?

## The Convex reactive query as a synchronization layer

Our existing architecture handles this for free, in shape. The Convex `useQuery(api.conversations.get, { id })` is a reactive subscription: when the row mutates server-side, every subscribed client re-renders with the new data.

That means:
- Tab A submits → mutation `sendMessage` writes the user message → Tab B sees it appear.
- Server flusher writes `streamingText` / `streamingParts` → Tab A and Tab B both see streaming progress.
- `onFinish` writes the assistant message + clears the streaming row → Tab A and Tab B both see the final message.

What our chat does today, in `chat-interface.tsx`:
- Active tab uses `useChat` for the SSE stream (faster, no Convex round-trip).
- Active tab also has the Convex query for "what is the canonical message list?".
- Inactive tabs see the Convex `streamingParts` mirror via `<CrossTabStream>`. The mirror is at most 250ms stale (the flusher tick).

This is the right architecture. The improvements are around *which tab gets to be "active"* and conflict-free continuation.

## t3code's dual-stream pattern

`~/src/os/t3code/packages/contracts/src/orchestration.ts:373–404`

```ts
OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({ kind: "project-upserted", sequence, project }),
  Schema.Struct({ kind: "thread-removed", sequence, projectId }),
  Schema.Struct({ kind: "thread-upserted", sequence, thread }),
]);
```

Two independent streams per environment:
- **Shell stream** — the sidebar. Pre-computed thread summaries (title, last activity, status flags). Writes are append-only; no conflicts.
- **Detail stream** — one active conversation. Messages, activities, plans. One subscriber per detail stream.

The shell stream is shared across tabs (everyone sees the sidebar update). The detail stream is per-tab (each tab subscribes to whichever conversation it's showing). Mutations come from one source per stream, so no two tabs race.

For our case: the conversation list (sidebar) is the shell; the active conversation is the detail. We already have this implicitly — the sidebar uses `useQuery(api.conversations.list)`, the active page uses `useQuery(api.conversations.get, { id })`.

## Conflict-free continuation

Two tabs see the same conversation. User submits from Tab A. Tab B should see the new user message + the streaming response. Tab B should *not* try to also fire its own `useChat.sendMessage`.

The natural rule: **only the tab that submits drives the stream**. The other tabs are observers via the Convex mirror.

How we encode this today:
- `useChat` in each tab has its own `messages` state. When Tab A fires `sendMessage`, only Tab A's useChat advances.
- Tab B's useChat sees no SSE activity. Its status stays `ready`.
- Tab B's Convex `streamingParts` query updates (because the server flusher writes to the shared row).
- We render a `<CrossTabStream>` block in Tab B when status is `ready` AND `serverStreamingText` is non-empty.

Edge case: Tab B mounts mid-stream (user opens the conversation in a new tab while it's running). What does Tab B see?

- Convex `useQuery(api.conversations.get)` returns the messages plus the streaming row.
- Tab B's useChat starts with `messages: initialMessages` (loaded from `messages` table; doesn't include the in-flight assistant).
- The streaming row in Convex shows the current state.
- We render the prior messages + a `<CrossTabStream>` for the in-flight one.
- When `onFinish` fires server-side, Convex `messages` updates with the final assistant message; we sync useChat's messages to match.

This works today.

## What tab is "active"?

The current rule: "active" = whichever tab is currently driving a stream (status === 'submitted' or 'streaming'). Other tabs render the mirror.

Failure mode: Tab A submits, then the user closes Tab A. Tab B is the only tab left. It still sees the streaming row in Convex. The route is still running (waitUntil).

When `onFinish` fires server-side, Tab B's Convex query fires. Tab B's useChat is in `status: 'ready'`. We sync messages from Convex to Tab B's useChat — but **Tab B never opened the SSE**, so it never sees the actual stream events. It just sees the final saved message.

Is that fine? Yes for read-only observers. Not great if the user is *actively reading* on Tab B and wants to see tokens land. The fix is the resumable-stream-context (see [09-persistence-resumption.md](./09-persistence-resumption.md)) — Tab B can also call `reconnectToStream` and become a second observer of the buffered SSE.

Once both tabs do that, we have proper multi-tab live observation.

## Composer drafts across tabs

If the user has Tab A and Tab B both showing the same conversation, and types in Tab A's composer, Tab B's composer doesn't see it. That's correct — drafts shouldn't leak across tabs. (If you want them to, persist drafts to localStorage keyed by conversation id, with a `BroadcastChannel` ping when they change. But for our use case, per-tab drafts are right.)

## The 30s watchdog and double-firing

If the route crashes server-side, the streaming row stays set. Our 30s stale-stream watchdog clears it.

When the watchdog clears, both tabs see `streamingText` go to undefined. Tab A (which originated the request) sees its useChat status flip to error if the SSE drops. Tab B has nothing to do — it just stops rendering the mirror.

There's a subtle bug: if the user has Tab A and Tab B both open, the watchdog runs in *both*. Both fire `clearStreamingMutation` + `disableMessageMutation`. Convex serializes the mutations; second one is a no-op (idempotent). But it's a wasted round-trip.

Fix: leader election via `BroadcastChannel`. The first tab to detect a stale stream broadcasts "I'm fixing it"; other tabs back off. Cheap; one channel per browser.

For now: the redundancy is harmless.

## Bidirectional message edits

If Tab A edits the trailing user message and re-submits, what does Tab B see?

Today:
- Tab A's `setMessages(slice)` is local state — Tab B doesn't see it.
- Tab A then submits → Convex `sendMessage` mutation writes a new user message → Tab B sees it appended.
- Tab B's useChat now has *more* messages than Tab A (Tab B has the old user message too).

Mismatch! Both tabs are looking at different "histories".

The fix:
1. **Edits go through Convex too.** Add a `disableMessage` mutation (we have it) AND a `truncateConversation(fromMessageId)` mutation that disables all later messages. Tab A calls truncate; both tabs converge.
2. **Tab B's useChat syncs from Convex** when status is `ready` AND Convex's message list is shorter than useChat's. Today we sync only when Convex is *longer*.

For our use case (single user, mostly single tab), this is rarely hit. Future-proof by syncing in both directions.

## What our chat does

`web/src/app/(main)/chat/_components/chat-interface.tsx`:
- Convex `useQuery(api.conversations.get)` for messages + streamingText/streamingParts. ✓
- Active tab uses useChat (SSE). ✓
- Inactive tab sees `<CrossTabStream>` from Convex mirror. ✓
- 30s stale-stream watchdog. ✓ (per-tab, redundant but harmless)
- Sync useChat from Convex when ready + Convex has more. ✓

## What to add

1. **Bidirectional message sync.** When `status === 'ready'` AND Convex's message list **differs** from useChat's, take Convex as the source of truth (covers both shorter-after-edit and longer-after-others-tab-finished cases).

2. **Resumable stream multi-observer.** Once Phase X adds `createResumableStreamContext`, every tab can call `reconnectToStream` and become a live observer of the same SSE buffer. Drop the Convex-mirror cross-tab path and use the resumable stream for *all* tabs. Keep Convex `streamingParts` for very-late observers (those that arrive after the buffer was discarded).

3. **Leader election via BroadcastChannel** for the 30s watchdog. Pure DX win; saves one Convex mutation per stale-stream event.

4. **Per-tab "active" indicator.** Small UI affordance: in Tab B, when Tab A is driving the stream, show "Streaming in another tab". Disambiguates "Why is my Stop button greyed out?".

## Top patterns to steal

| Pattern                                                | From         |
| ------------------------------------------------------ | ------------ |
| Reactive mirror as the cross-tab sync layer            | (us, Convex) |
| Dual stream: shell (sidebar) + detail (active conv)    | t3code       |
| Only-the-submitter-tab drives the SSE                  | (us)         |
| Resumable stream as multi-observer                     | vercel/ai    |
| BroadcastChannel for leader election                   | (recommended)|
| Bidirectional sync (Convex truncates also syncs other tab) | (recommended) |
| Per-tab "active in other tab" indicator                | (recommended)|

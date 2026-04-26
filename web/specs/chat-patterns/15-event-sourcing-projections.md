# Event Sourcing + Projections

The most architecturally ambitious pattern from the reference repos. Probably overkill for our chat today, but worth understanding because it generalizes our existing Convex flusher in a clean direction.

## t3code's event log

`~/src/os/t3code/apps/server/src/persistence/Migrations/001_OrchestrationEvents.ts:7–23`

```sql
CREATE TABLE orchestration_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE,
  aggregate_kind TEXT,        -- e.g., 'thread', 'project', 'turn'
  stream_id TEXT,             -- the resource id (thread id, etc.)
  stream_version INT,         -- monotonic per stream
  event_type TEXT,            -- 'thread.created', 'turn.started', 'message.appended', ...
  occurred_at TEXT,
  command_id TEXT,            -- the command that produced this event
  causation_event_id TEXT,    -- the event that caused this command
  correlation_id TEXT,        -- for tracing
  payload_json TEXT,          -- the event payload
  metadata_json TEXT          -- (provenance, user, environment)
);
```

Every state change in t3code is an event. The events are the source of truth. The current state of a thread, a project, a sidebar list — all are *projections* computed by replaying events.

## Why this is powerful

1. **Audit trail.** You can answer "what happened in this conversation, in what order?" by reading the event log.
2. **Replay.** Reconnecting clients fetch events `since: lastSequence`. Server doesn't have to maintain per-client state.
3. **Time travel.** "Show me the state of this conversation at 14:32" — replay events up to that timestamp.
4. **Multiple projections.** The same events drive both the sidebar (projection: thread summary by id) and the detail view (projection: full message list by thread id). New projections cost nothing to add.
5. **Causation graph.** `causation_event_id` makes it easy to see "this assistant message was caused by this user message which was caused by this approval response".

## Why it's heavy

- Every write goes through the event log first, then into projections.
- Projections must be rebuilt when the event schema changes (migrations).
- Event types are forever. Renaming an event type is a versioning exercise, not a refactor.
- You need a projection runner — code that reads events and updates the read models.

## How Convex maps to this

Convex's mutation log is *already* event-sourced under the hood, but Convex doesn't expose it as a queryable event stream. The mutations themselves are the events; the tables are the projections.

We can simulate a t3code-style event log on top of Convex with a `chat_events` table:

```ts
// convex/schema.ts (sketch — for reference only)
chat_events: defineTable({
  sequence: v.number(),
  conversationId: v.id('conversations'),
  type: v.string(),               // 'turn.started', 'text.delta', 'tool.called', ...
  payload: v.any(),
  occurredAt: v.number(),
}).index('by_conversation_seq', ['conversationId', 'sequence']),
```

Every flusher write becomes an event insert. The `messages` and `conversations` tables become *projections* updated on each event.

Why we wouldn't do this immediately:
- Adds latency (event insert + projection update for every chunk).
- Needs a projection runner (we'd write it).
- The flusher already gives us the durability we need.

When we'd want it:
- If we add audit/compliance requirements (regulated medical info — possibly relevant for our patient-data context!).
- If we add multi-projection use cases (e.g., a "search across all conversations" surface that needs a different shape than the message list).
- If we need time travel ("show me what was said before this checkpoint").

## A pragmatic middle ground: command log without full event sourcing

Instead of every chunk being an event, log only the *commands* (high-level user/system intents):

```
chat_commands:
  - sendUserMessage(text)
  - acceptApproval(callId)
  - regenerateLastResponse()
  - editMessage(messageId, newText)
```

Plus the **outcomes** as their own events:
```
  - assistantMessageCommitted(messageId, parts)
  - approvalGranted(callId)
  - turnAborted(reason)
```

Skip the streaming chunks. Those don't need to be durable beyond the current Convex flusher.

This gives us:
- Audit trail of user actions and final outcomes.
- Replay of "what the user did" if needed.
- ~10× lower write volume than per-chunk events.

## The shell + detail projection split

`~/src/os/t3code/apps/web/src/store.ts:41–95` (Zustand store)

The web client maintains two projections:
- **Shell**: a list of thread summaries (id, title, lastActivityAt, status flags, hasPendingApprovals).
- **Detail**: the messages + activities for one active thread.

Both are derived from the same underlying events but kept structurally separate to avoid render storms when only one projection should update.

Maps to our chat:
- **Sidebar list** (`api.conversations.list`) — shell projection. Today we compute it as a Convex query that filters by archived; t3code pre-computes a denormalized table.
- **Active conversation** (`api.conversations.get`) — detail projection.

For our scale, Convex's reactive queries are fast enough that we don't need to denormalize. If thread counts grow into the thousands and the sidebar query gets slow, denormalize then.

## Causation chains

`causation_event_id` records which event caused this one. In a chat:
- User message (cause) → assistant message (effect)
- Approval request (cause) → approval response (effect)
- Tool call (cause) → tool result (effect)

For our use case, this is mostly visible in the parts model already (tool call and result share `toolCallId`; user and assistant messages are adjacent). Codifying it in a causation graph is overkill *unless* we add forks ("regenerate from this point") or branches ("explore alternative answer").

## What our chat does

- Convex `messages` table is the persisted message log (effectively a projection).
- Convex `conversations` row is the projection of "thread metadata".
- Convex `streamingParts` is a transient per-thread row, cleared on `onFinish`.
- No event log; mutations directly update projections.

This is the right level of complexity for now.

## What to add (if anything)

The event-sourcing path would only be worth taking if:

1. **We need audit/compliance** for medical-context data. The patient-data context might justify it. Check with the user.

2. **We need conversation forks.** "Regenerate this answer from a different model" or "Branch the conversation here" — both benefit from an event log because the forks are easy to compute (replay events up to point X, then a different command after).

3. **We need cross-conversation analytics.** "Which tools are most frequently approved?" "Which queries lead to the most search-then-read sequences?" An event log makes these queries straightforward.

For now, my recommendation is: **don't event-source the chat yet**. Document the migration path (this file) so future-you knows it's possible. Add the smaller `data-*` parts pattern (server emits structured data parts to drive client UI) as a stepping stone.

## Top patterns worth keeping in mind (not necessarily stealing)

| Pattern                                                   | From    | Take it?                          |
| --------------------------------------------------------- | ------- | --------------------------------- |
| Event log + projections                                   | t3code  | Document; defer                   |
| `causation_event_id` for traceability                     | t3code  | Defer                             |
| Pre-computed shell projection for sidebar                 | t3code  | Defer (Convex queries fast enough)|
| Server emits `data-*` parts for app-defined data          | vercel  | **Take** (lighter version of projections) |
| Command log only (skip per-chunk events)                  | (hybrid)| Take if compliance/forks land     |
| Time-travel via event replay                              | t3code  | Defer                             |

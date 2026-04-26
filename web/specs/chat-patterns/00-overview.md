# Agent Chat UI — Pattern Library

Distilled best practices for full-stack agent chat user interfaces, drawn from a deep read of five reference repos cloned into `~/src/os/`:

- `vercel-ai/` — the AI SDK v6 source (`packages/ai`, `packages/@ai-sdk/react`, `examples/next`, `examples/next-agent`)
- `tanstack-ai/` — TanStack AI (`packages/typescript/ai-client`, `ai-react`, `examples/typescript/ts-react-chat`, `ts-group-chat`)
- `shadcn-ui/` — shadcn/ui registry (`apps/v4/registry/new-york-v4/`)
- `t3code/` — Theo's coding agent (`apps/web`, `apps/server`, `packages/effect-acp`, `packages/contracts`, `packages/client-runtime`)
- `codex/` — OpenAI Codex (`codex-rs/protocol`, `codex-rs/tui`, `codex-rs/core`, `sdk/typescript`)

Each subsequent file in this directory covers one concept end-to-end with cross-repo citations and concrete code shape.

## Files in this directory
- [01-streaming-architecture.md](./01-streaming-architecture.md) — transports, chunking, smoothing, throttling
- [02-message-parts-model.md](./02-message-parts-model.md) — typed parts, discriminated unions, multimodal
- [03-tool-calling-ux.md](./03-tool-calling-ux.md) — input-streaming → output-available state machine
- [04-agent-loop.md](./04-agent-loop.md) — stopWhen, prepareStep, multi-step, ToolLoopAgent
- [05-rendering-performance.md](./05-rendering-performance.md) — memoized prior list + streaming tail, equality contracts
- [06-composer-input.md](./06-composer-input.md) — IME, autosize, attachments, slash commands
- [07-scroll-pin.md](./07-scroll-pin.md) — stick-to-bottom, escape lock, pill UX
- [08-markdown-rendering.md](./08-markdown-rendering.md) — incremental parse, partial fences, code blocks, math
- [09-persistence-resumption.md](./09-persistence-resumption.md) — **navigation resilience**, resumable streams, replay
- [10-error-abort.md](./10-error-abort.md) — error vs abort vs disconnect, recovery, retries
- [11-approval-workflow.md](./11-approval-workflow.md) — first-class approval state, callId pairing
- [12-multi-tab-cross-window.md](./12-multi-tab-cross-window.md) — Convex mirror, dual streams, conflict-free sync
- [13-component-composition.md](./13-component-composition.md) — shadcn primitives, asChild, data-slot
- [14-accessibility.md](./14-accessibility.md) — role=log, aria-live, motion-reduce, focus rings
- [15-event-sourcing-projections.md](./15-event-sourcing-projections.md) — event log + read models, t3code pattern

## Cross-cutting design tenets

These show up in every reference repo and are the spine of the rest of the docs.

1. **Server runs to completion, independent of the client.** The route handler does not stop when the user navigates away. The work survives in a mirror (Convex, Postgres, SQLite event log, server-buffered SSE) and is re-readable. Codex's thread_id replay, vercel/ai's `createResumableStreamContext`, and t3code's event log all enforce this. **This is non-negotiable for our chat.**

2. **Discriminated parts, not flat content.** A message is a list of typed parts (`text` | `reasoning` | `tool-<name>` | `source` | `data-<name>` | `file`). Each part carries its own state machine. Vercel's `UIMessage<META, DATA, TOOLS>` and TanStack's `MessagePart` discriminated union both pivot on this. Flat `content: string` is a dead end for agent UIs.

3. **Throttle DOM, never the stream.** Tokens hit memory at provider speed. UI commits batch to ≤20Hz via `experimental_throttle: 50` (vercel/ai) or callback batching (TanStack). Server cadence smoothing (`smoothStream({ delayInMs: 25, chunking: 'word' })`) is independent of UI throttling.

4. **Memoize prior, render the tail live.** Every reference repo splits the message list into "committed" (memoized, never re-renders during streaming) and "active" (re-renders per token). Codex calls these `transcript` + `active_cell`. Vercel splits `messages.slice(0, -1)` from `messages[length-1]`. The tail is the entire per-token render budget.

5. **Approval is a first-class state.** TanStack and Codex both model it as an event with a `call_id` that pairs request and response. The agent loop pauses; the UI shows a confirmation; the response resumes the loop. Don't bolt approval onto tool execution — separate them.

6. **Event-sourced server, projected reads.** t3code stores immutable events; the sidebar (shell stream) and a single conversation (detail stream) are projections. Two streams, no conflicts, replayable. Our Convex schema is move-able toward this.

7. **Composition over configuration.** shadcn's `asChild` + `data-slot` + Slot pattern is what makes the Conversation / Message / PromptInput compound API in ai-elements work. Same idea everywhere: small primitives, no monolithic chat component.

## Repo-by-repo summary of strengths

| Repo            | What it's best at                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `vercel/ai`     | useChat v6 transport + throttling, smoothStream, ToolLoopAgent, resumable stream context, the canonical `next/api/chat` route. |
| `tanstack/ai`   | Headless `ChatClient` + thin React adapter, parts-based discriminated union, approval as first-class state, custom events.     |
| `shadcn/ui`     | Composition primitives (Slot, asChild, data-slot, Sidebar, Field, Sonner, cmdk), CSS-vars + OKLCH theming.                     |
| `t3code`        | Dual-stream architecture (shell + detail), event sourcing + projections, RPC over Effect, multi-environment scoping.           |
| `openai/codex`  | Event/Op submission queue model, active-cell + transcript split, approval coupling via call_id, token-cache visibility.        |

## Pivotal cross-repo agreement

When all five reference repos converge on the same pattern, that's the pattern to take.

| Pattern                                              | vercel/ai | tanstack/ai | shadcn | t3code | codex |
| ---------------------------------------------------- | :-------: | :---------: | :----: | :----: | :---: |
| Discriminated parts on messages                      | ✓         | ✓           | n/a    | ✓      | ✓     |
| Streaming-tail vs memoized-prior split               | ✓         | ✓           | n/a    | ✓      | ✓     |
| Server-side resilience independent of client         | ✓         | (transport) | n/a    | ✓      | ✓     |
| Approval as first-class event                        | (v6 added)| ✓           | n/a    | ✓      | ✓     |
| Token-cadence smoothing on the wire                  | ✓         | (impl-spec) | n/a    | (impl) | (frame batch) |
| DOM-update throttling on the client                  | ✓         | (callback batch) | n/a | (equality)| n/a |
| Compound components / Slot composition               | (ai-elem) | n/a         | ✓      | ✓      | n/a   |
| Stick-to-bottom + escape lock                        | (ai-elem) | (per app)   | (apps) | (per app)| (TUI)|
| Event/Op queue model on the wire                     | (chunks)  | (chunks)    | n/a    | (RPC)  | ✓     |
| Idempotent saves with server-generated IDs           | ✓         | ✓           | n/a    | (event log)| ✓ |

## What we already do that aligns

- Convex flusher writes a mirror so navigation away doesn't kill the stream (matches Codex/t3code intent).
- Single-flight `finalize()` on `onFinish` is idempotent.
- Active tab uses `useChat` + `experimental_throttle: 50` + `DefaultChatTransport`.
- `<PriorMessages>` memoized + `<StreamingMessage>` per-token tail.
- `<Conversation>` + `<PromptInput>` from ai-elements (compound components).

## What we do not yet do (the audit material)

See [AUDIT.md](./AUDIT.md) for the full per-pattern current-state table and [IMPROVEMENTS.md](./IMPROVEMENTS.md) for the prioritized work plan.

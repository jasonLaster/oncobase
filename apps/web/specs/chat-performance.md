# Chat Performance Spec

Target architecture for the chat page (frontend + backend) so streaming feels smooth, message lists stay responsive at 100+ turns, and the system tolerates flaky networks and tab switches.

This complements [chat-performance-plan.md](./chat-performance-plan.md) (phased implementation) and [chat-performance-testing.md](./chat-performance-testing.md) (test scenarios + perf budgets). This document defines **what we are building toward and why**, not how to ship it.

## In this spec
- [Goal](#goal)
- [Scope](#scope)
- [Current state — bottlenecks worth fixing](#current-state--bottlenecks-worth-fixing)
- [External patterns we are borrowing](#external-patterns-we-are-borrowing)
- [Target architecture](#target-architecture)
  - [Streaming model](#streaming-model)
  - [Message + parts model](#message--parts-model)
  - [Component tree and rendering contract](#component-tree-and-rendering-contract)
  - [Persistence and recovery](#persistence-and-recovery)
  - [Backend route shape](#backend-route-shape)
- [Performance budget](#performance-budget)
- [Out of scope](#out-of-scope)
- [Open questions](#open-questions)

## Goal

The chat page should feel as smooth as the canonical Vercel AI chatbot at any reasonable thread length, on a mid-tier laptop and a mid-range phone, while keeping the features that make our chat distinctive:

- Convex-backed history with cross-tab live updates and durable resume.
- Tools that search and read the wiki, with progressive UI as inputs and outputs stream in.
- Reasoning, tool, and source surfaces rendered alongside markdown answers.

Concretely, the page should:

- Render a streaming token within ~16ms of the client receiving it (one frame).
- Sustain ≥55fps while the assistant is typing into a 50-message thread.
- Avoid re-rendering prior messages on every token of the current message.
- Survive a tab refresh mid-stream and resume rendering without losing tokens.
- Submit and abort cleanly on slow networks; never wedge the input.

## Scope

In scope:
- The chat route at `apps/web/src/app/(main)/chat/`, including `[id]/page.tsx`, `[id]/client.tsx`, and `_components/chat-interface.tsx`.
- The chat API route at `apps/web/src/app/api/chat/route.ts`.
- The Convex `conversations` and `messages` tables and the streaming flush path that the route writes to.
- The markdown renderer used by streaming + persisted assistant messages.
- The composer (input textarea + submit button + abort).

Not in scope (tracked separately):
- The wiki page itself or any non-chat consumers of the markdown renderer.
- Vector / text search index quality. We are tuning how results stream into the UI, not how they are produced.
- Prompt content. We are tuning how the system prompt is *assembled and cached*, not what it says.

## Current state — bottlenecks worth fixing

Versions in use today: `ai@^6.0.147`, `@ai-sdk/react@^3.0.149`, `next@16.2.2`, `react@19.2.4`, `react-markdown@10.1.0`. No `streamdown`, no `use-stick-to-bottom`, no list virtualization library.

Frontend findings (paths under `apps/web/src/app/(main)/chat/`):

1. **No `useChat`.** `src/app/(main)/chat/_components/chat-interface.tsx` drives the stream by hand: `fetch("/api/chat")` plus a Convex `useQuery` subscription to `conversation.streamingText` and `conversation.streamingParts`. This means tokens travel client -> server -> Convex -> client, gated by the 500ms server flush interval, instead of arriving directly over SSE.
2. **`streamingParts` is a JSON string in Convex.** `chat-interface.tsx:384` calls `JSON.parse` inside `useMemo`, but the *string* changes on every flush, so the parse runs every flush.
3. **Whole list re-renders on every token.** `chat-interface.tsx:660` maps `messages` on each render, the streaming block at `chat-interface.tsx:697` re-renders on every change to `serverStreamingText`, and the existing assistant-message rendering does not memoize per message.
4. **Plain `react-markdown` for streaming text.** Each token reparses the entire growing string. Unclosed code fences and partial tables flicker.
5. **Auto-scroll uses imperative `scrollTop = scrollHeight`** (`chat-interface.tsx:422`) on every state change. No backpressure, no "user scrolled up" pin contract beyond a 100px threshold check.
6. **Module-level `messageCache` Map** in `[id]/client.tsx` grows unbounded as users browse threads.
7. **No IME composition handling** on the composer (`chat-interface.tsx:777`). Submitting on `Enter` while composing Japanese / Chinese / Korean breaks input.
8. **Auto-resume on mount** re-triggers generation if the last message is `user` and no stream is live, with no debounce; double-mounts in dev or fast remounts can fire twice.
9. **No virtualization.** Long threads will degrade smoothly until they don't.

Backend findings (`apps/web/src/app/api/chat/route.ts`):

10. **`buildSystemPrompt` runs on every request,** including a Convex query for the patient diagnosis and the wiki page index. Both are stable across most requests.
11. **No `experimental_transform`.** Token cadence is whatever the model produces, which is jittery.
12. **Two write paths to Convex.** Text flushes on a 500ms interval; tool calls / results flush immediately via `flushNow`. They share the same row but fight for it under load.
13. **Server IDs come from the model stream, not a deterministic generator.** Saves on `onFinish` are not idempotent against retries.
14. **Tool result `content` is stripped to keep the streaming row small,** but the same fields then have to be reconstructed for persistence on `onFinish`.

## External patterns we are borrowing

Documented in detail in [chat-performance-plan.md](./chat-performance-plan.md) under each phase. The headline patterns:

- **`useChat` v6 with `experimental_throttle`** (vercel/ai-chatbot). Batches DOM updates to one paint per N ms. Real-world demos report ~10× fewer renders during streaming.
- **`smoothStream({ chunking: 'word', delayInMs: 25 })`** server transform (vercel/ai). Releases tokens at word boundaries on a controlled cadence. Eliminates per-token jitter.
- **Static prior messages + streaming tail** (vercel/ai-chatbot's `Messages` component). Memoized message rows render only when their own content changes; the tail message is the only thing that re-renders per token.
- **`UIMessage` parts model** (AI SDK v5+/v6). Text, reasoning, tool-call, and source parts are typed and rendered independently. Each part type has its own component, so a tool result does not invalidate the text block above it.
- **Tool state machine: `input-streaming → input-available → output-available → error`** (AI SDK v6 + ai-elements `<Tool>`). Lets us show progressive tool UIs without layout thrash.
- **Streamdown for streaming markdown** (vercel/ai). Hardened with rehype-sanitize, renders incomplete fences and tables gracefully, and is the supported renderer behind ai-elements `<MessageResponse>`.
- **`use-stick-to-bottom`** (used inside ai-elements `<Conversation>`). Proper pin contract: stays at bottom, releases on user scroll, shows a "new messages" pill when behind, never fights the user.
- **`createIdGenerator()` + idempotent `onFinish` save** (vercel/ai docs on persistence). Server-stamped ids keep saves safe under retries and dev double-mounts.
- **Parts-first persistence** (TanStack AI, t3code). Store the structured parts array natively rather than a JSON string. Reads stay O(1) per render.

## Target architecture

### Streaming model

The chat will run a **hybrid stream**: direct SSE to the current tab via the AI SDK UI message stream protocol, plus a Convex mirror for durability and cross-tab visibility.

```
                ┌────────────────────────────────────────┐
   /api/chat ──▶│ streamText (smoothStream + tools)      │──▶ toUIMessageStreamResponse
                │                                        │       (SSE → useChat in active tab)
                │ onChunk ──▶ Convex flusher (≤4 Hz)     │──▶ conversations.streamingParts
                │ onFinish ──▶ Convex saveMessages       │       (cross-tab + history)
                └────────────────────────────────────────┘
```

Why hybrid:

- The active tab gets tokens directly over SSE. No 500ms Convex round-trip.
- Other tabs and reconnecting clients get a near-live mirror through the existing Convex subscription.
- On reconnect mid-stream, the client falls back to the Convex mirror, which is at most 250ms stale.
- Persistence is a single `onFinish` write to `messages`, not a dual write that has to be reconciled.

The Convex mirror flush rate drops from 500ms to **250ms** with coalesced writes, and the streaming-parts column moves from a JSON string to a native array (see schema change in the plan).

### Message + parts model

```ts
// apps/web/src/lib/chat/types.ts (new)
import type { UIMessage } from 'ai';

type ChatMetadata = {
  conversationId: string;
  disabled?: boolean;
};

type ChatDataParts = {
  // domain-specific data parts we already emit
  'source-pages': { slug: string; title: string }[];
};

type ChatTools = {
  search_wiki: typeof searchWikiTool;
  read_page: typeof readPageTool;
  list_pages: typeof listPagesTool;
  get_pages_by_tag: typeof getPagesByTagTool;
  list_tags: typeof listTagsTool;
};

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts, ChatTools>;
```

Each part is rendered by a dedicated component:

| Part type                         | Component             | Memo key                  |
| --------------------------------- | --------------------- | ------------------------- |
| `text`                            | `<MessageMarkdown>`   | `text` slice              |
| `reasoning`                       | `<ReasoningBlock>`    | `text` slice + `state`    |
| `tool-search_wiki` (any state)    | `<SearchResultsBlock>`| `state` + `output` ref    |
| `tool-read_page` (any state)      | `<ReadPageBadge>`     | `state` + `input.slug`    |
| `tool-*` fallback                 | `<ToolCallBlock>`     | `state` + `toolName`      |
| `data-source-pages`               | `<SourceLinks>`       | `data.length` + last id   |

The Convex schema for `messages.parts` and `conversations.streamingParts` becomes a typed array (no `JSON.stringify`). See [chat-performance-plan.md](./chat-performance-plan.md) Phase 2 for the migration.

### Component tree and rendering contract

```
chat/[id]/page.tsx                      (Server Component — auth + initial history fetch)
└── ChatPageShell (Server)              (layout, sidebar, suspense boundary)
    └── ChatClient (Client)             (uses useChat; nothing else)
        ├── <Conversation>              (use-stick-to-bottom; scroll pin contract)
        │   ├── <PriorMessages>         (memoized list; never re-renders per token)
        │   │   └── <MessageRow>        (React.memo on message id + version)
        │   │       └── parts.map → <PartRenderer />  (memoized per part type)
        │   ├── <StreamingMessage>      (the only thing that re-renders per token)
        │   │   └── <PartRenderer />    (text → Streamdown, tool → ToolBlock, …)
        │   └── <ConversationScrollButton />
        └── <Composer>                  (textarea + submit + abort + IME-safe)
```

Rendering contract:

- The page is a Server Component. It fetches `conversation` and `messages` server-side and passes `initialMessages` to the client.
- `ChatClient` is the *only* component that holds `useChat` state.
- `<PriorMessages>` is wrapped in `React.memo` and keyed off `messages.length` + the id of the last completed message. It never re-renders during streaming.
- `<StreamingMessage>` reads only the last message and is the sole component that re-renders per token, throttled to one update per ~50ms via `useChat({ experimental_throttle: 50 })`.
- `<PartRenderer>` is `React.memo`'d on its `part` reference. Stable parts in the streaming message do not re-render when later parts arrive.

### Persistence and recovery

- IDs come from `createIdGenerator({ prefix: 'msg' })` on the server. The client never invents persisted ids.
- The single source of truth for saved messages is `messages` in Convex. The streaming row on `conversations` is a *mirror* and is cleared on `onFinish`.
- The hybrid stream resolves three failure cases cleanly:
  - **Active tab disconnects mid-stream.** Reconnect path: load `conversations.streamingParts` and replay; if the stream has finished while disconnected, load `messages` instead.
  - **User refreshes mid-stream.** Same as above. The `streamingParts` mirror is the recovery surface.
  - **Server stops without `onFinish`.** A 30s stale-stream watchdog (the existing one) flips the conversation back to "ready" and disables the trailing user message, unchanged from today.
- The module-level `messageCache` in `[id]/client.tsx` becomes a bounded LRU (cap 20 conversations) so heavy navigators do not leak memory.

### Backend route shape

`apps/web/src/app/api/chat/route.ts` is reorganized to look like this (sketch — full code in the plan):

```ts
export async function POST(req: Request) {
  await connection();

  const { messages, conversationId } = ChatRequestSchema.parse(await req.json());

  const systemPrompt = await getCachedSystemPrompt(conversationId);
  const flusher = createConvexFlusher(conversationId, { intervalMs: 250 });

  const result = streamText({
    model: fastTextModel(),
    system: systemPrompt,
    messages: convertToModelMessages(messages),
    stopWhen: stepCountIs(10),
    tools: chatTools,
    experimental_transform: smoothStream({ delayInMs: 25, chunking: 'word' }),
    onChunk: ({ chunk }) => flusher.push(chunk),
    onError: (err) => flusher.recordError(err),
    onFinish: ({ messages: finalMessages }) => flusher.finalize(finalMessages),
    abortSignal: req.signal,
  });

  return result.toUIMessageStreamResponse({
    generateId: createIdGenerator({ prefix: 'msg' }),
  });
}
```

Key changes from today:

- `getCachedSystemPrompt` memoizes the diagnosis + page index for `MAX_AGE_MS = 60_000` per conversation. Cache misses still fetch from Convex.
- `createConvexFlusher` is the only writer to `conversations.streamingParts` and runs at 4 Hz with coalesced text deltas. Tool calls and results still flush at the next tick (≤250ms latency, not immediate).
- `smoothStream` provides per-word cadence; `experimental_throttle` on the client smooths DOM updates.
- The route returns `toUIMessageStreamResponse()` so the client can use `useChat` directly. The Convex flush is a *side effect*, not the transport.

## Performance budget

These are the gates [chat-performance-testing.md](./chat-performance-testing.md) enforces.

| Metric                                                            | Today (measured) | Target  |
| ----------------------------------------------------------------- | ---------------- | ------- |
| First-token latency (user submit → first painted token)           | ~1100ms          | ≤700ms  |
| Steady-state stream FPS in a 50-message thread (mid-tier laptop)  | ~28fps           | ≥55fps  |
| React commits per second during streaming                         | ~30/s            | ≤20/s   |
| DOM nodes added per streamed token                                | full re-render   | O(1)    |
| Time-to-interactive after thread switch (warm cache, 100 msgs)    | ~1400ms          | ≤500ms  |
| Mid-stream tab refresh recovery                                   | full reload      | ≤300ms  |
| Composer input lag while assistant streams                        | visible jitter   | none    |

## Out of scope

- A redesigned chat UI. Visual changes are limited to what is implied by adopting ai-elements primitives we already need (e.g., `<Conversation>`, `<PromptInput>`).
- Server-side scaling beyond what the existing Vercel + Convex setup provides. We assume Fluid Compute and Convex are healthy.
- Replacing Convex as the persistence layer.
- Changing the model or the tool set (we are tuning *delivery*, not behavior).
- Mobile-only ergonomics beyond the IME composition fix and a sanity check on iOS keyboard behavior.

## Open questions

1. **Drop the Convex mirror entirely?** A simpler architecture is: SSE for the active tab, `onFinish` save only, no `streamingParts` row. We lose cross-tab live streaming and lose recovery from mid-stream refresh in tabs that did not initiate. Recommendation: keep the mirror but reduce its frequency. Revisit if cross-tab is unused.
2. **Adopt ai-elements components or wrap our own?** ai-elements gives us `<Conversation>`, `<Message>`, `<Tool>`, `<Reasoning>`, `<CodeBlock>` for free, with `use-stick-to-bottom` integrated. The cost is buying into Streamdown for markdown. Recommendation: adopt them piecemeal, starting with `<Conversation>` and `<PromptInput>`. The plan stages this.
3. **Move to Streamdown for markdown?** We currently lean on `react-markdown` with a chunky plugin set (gfm, math, slug, custom wikilinks, custom citations). Streamdown supports streaming-aware parse and matches our security needs out of the box, but our wikilink and citation transforms have to be ported. Recommendation: port. The plan has a dedicated phase.
4. **List virtualization now or later?** We have not measured a real user with 200+ messages. Recommendation: ship the memoization + Streamdown wins first; revisit virtualization once we have a thread that hurts.

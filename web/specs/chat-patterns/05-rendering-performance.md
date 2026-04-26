# Rendering Performance

How to make a 200-message thread streaming at 80 tok/s feel smooth.

## The active-cell + transcript split

`~/src/os/codex/codex-rs/tui/src/chatwidget.rs:1–100`

```rust
pub struct ChatWidget {
    transcript: Vec<HistoryCell>,  // committed, immutable, never re-rendered during streaming
    active_cell: HistoryCell,       // mutable, accumulating, re-rendered per delta
    task_running: bool,
}
```

This pattern shows up in every reference repo:
- Codex: `transcript` + `active_cell`.
- Vercel/ai-chatbot: `messages.slice(0, -1)` + `messages[length-1]`.
- TanStack: `messages` array + a streaming-message tracker (per-message stream state).

The rule: **only one component re-renders per token**. Everything else is memoized and never invalidates while streaming.

## Memoization equality contracts

The `<PriorMessages>` memo only re-renders when one of:
1. The list length changed (new message landed)
2. The last message id changed (someone edited)
3. The handler ref changed (rare; should be `useCallback`-stabilized)

```ts
// web/src/app/(main)/chat/_components/messages.tsx
export const PriorMessages = memo(PriorMessagesImpl, (prev, next) => {
  if (prev.onEditUser !== next.onEditUser) return false;
  if (prev.messages.length !== next.messages.length) return false;
  if (prev.messages.length === 0) return true;
  const lastA = prev.messages[prev.messages.length - 1];
  const lastB = next.messages[next.messages.length - 1];
  return lastA.id === lastB.id && lastA === lastB;
});
```

useChat's append-only message updates keep prior message *references* stable. `lastA === lastB` is therefore a safe O(1) check.

## React.memo on each part renderer

`web/src/app/(main)/chat/_components/messages.tsx`

```ts
const ReasoningBlock = memo(function ReasoningBlock({ text }) { ... });
const ReadPageBadge = memo(function ReadPageBadge({ input, output, done }) { ... });
const SearchResultsBlock = memo(function SearchResultsBlock({ output, done, query }) { ... });
const ToolCallBlock = memo(function ToolCallBlock({ toolName, state, output, input }) { ... });
const MessageMarkdown = memo(function MessageMarkdown({ content }) { ... });
const SourceLinks = memo(function SourceLinks({ pages }) { ... });
```

When the streaming tail re-renders, the unchanged tool blocks (with stable `state`/`output` refs) bail out. Only the trailing text part actually re-runs ReactMarkdown.

## Throttled subscriptions in useChat

`~/src/os/vercel-ai/packages/react/src/chat.react.ts:68–79`

```ts
'~registerMessagesCallback': (onChange, throttleWaitMs) => {
  const throttled = throttleWaitMs ? throttle(onChange, throttleWaitMs) : onChange;
  return this.subscribeToMessages(throttled);
},
```

`throttleit` coalesces calls within the window. State mutations still fire at provider speed; only the React `onChange` callback is throttled. This means:
- Latest state is always available via `chat.messages` (the mutation source of truth).
- DOM commits run at most every `throttleWaitMs` (50ms = 20Hz).
- Intermediate frames are *dropped*, not queued. The next commit captures whatever batch accumulated.

## TanStack's structural-equality store

t3code: `~/src/os/t3code/apps/web/src/store.ts:128–378`

```ts
function threadSessionsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.provider === b.provider
      && a.status === b.status
      && a.activeTurnId === b.activeTurnId;
}

const next = computeNext(state);
if (!threadSessionsEqual(state.session, next.session)) {
  state.session = next.session;
}
```

When two streams (shell + detail) write to the same store, naive update would cause a render storm. Structural equality drops no-op updates. The cost is one comparison per write; the savings can be 10–100× fewer renders on busy threads.

## Codex's frame batching

`~/src/os/codex/codex-rs/tui/src/`

```rust
fn schedule_frame(&mut self) {
    self.needs_redraw = true;
    // The runtime drains needs_redraw at frame boundary, ~16ms,
    // not on every event. Multiple deltas in one frame are coalesced.
}
```

The TUI doesn't repaint per delta. It marks "needs redraw" and the next frame tick (~16ms) renders whatever the buffers say. This is exactly what `experimental_throttle: 50` achieves in the React world, modulo the unit (frame vs ms).

## Don't re-parse markdown on every token

The markdown renderer is the most expensive thing in a chat message. ReactMarkdown re-parses the entire string on each render. That's:
- O(n) where n = full message length (not delta length)
- Plus syntax highlighting if you have code blocks
- Plus katex if you have math

Two strategies:

1. **Streamdown.** `~/src/os/vercel-ai` chatbot reference. `parseIncompleteMarkdown: true` handles partial fences/tables. It parses incrementally and caches per-block. Same component, drop-in replacement.

2. **Memoized blocks.** Split the markdown by block (paragraph / code fence / table) and memoize each. The trailing partial block re-renders; the prior blocks don't.

```ts
const MemoizedBlock = memo(({ content }) => <ReactMarkdown>{content}</ReactMarkdown>);

function MessageMarkdown({ content }) {
  const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);
  return blocks.map((b, i) => <MemoizedBlock key={i} content={b} />);
}
```

Streamdown does this internally.

## Virtualization — when to add it

None of the reference repos virtualize the message list by default:
- vercel/ai-chatbot: no virtualization
- TanStack: no virtualization in `ts-react-chat`
- t3code: virtualizes the **diff panel**, not the message list
- Codex TUI: scrollback is implicit (terminal does it)

Reasons:
- Memoized prior list with stable refs = cheap re-render even at 200+ messages
- Variable-height messages make virtualization brittle
- Scroll-to-bottom + sticky-bottom contracts are harder with virtualization

When to add virtualization (`@tanstack/react-virtual`):
- > 500 messages in a single thread (rare for our use case)
- Mobile devices showing > 100 messages
- Tools that emit large outputs (e.g., search returns 50 results × 5 results-per-tool = 250 cards)

For now: don't.

## What our chat does

`web/src/app/(main)/chat/_components/`:
- `messages.tsx` — `<PriorMessages>` memoized + `<StreamingMessage>` not memoized. ✓
- Per-part renderers wrapped in `React.memo`. ✓
- `useChat({ experimental_throttle: 50 })`. ✓
- `react-markdown` (not Streamdown by default). Streamdown is wired behind `NEXT_PUBLIC_CHAT_STREAMDOWN=1`.
- No virtualization. ✓
- `useMemo` on the streaming-tail derivation. ✓

## What to add

1. **Flip Streamdown on by default.** We already wired it. The remaining cost is verifying parity (math, wikilinks, citations). After audit pass, remove the flag.

2. **Move source-pages computation to the server.** `extractSourcePages(parts)` runs on every render of `<AssistantMessage>`. Emit a `data-source-pages` part from `onFinish` instead. The renderer reads `part.data` directly — no traversal.

3. **Cache markdown parses by block hash.** Streamdown does this; if we keep `react-markdown` for some path, add a `useMemo` keyed by content hash so identical text doesn't re-parse.

4. **Drop the `groupParts` helper from the render path.** It runs on every render. Either compute it once with `useMemo`, or model groups as a server-side concept and emit them as data parts.

5. **Add a render-counter dev tool.** A small overlay that shows commits/sec for `<ChatClient>`, `<PriorMessages>`, `<StreamingMessage>` so we can spot regressions. The Phase 0 perf buffer infra (`web/src/lib/chat/perf.ts`) already supports this; add a UI.

## Top patterns to steal

| Pattern                                                    | From          |
| ---------------------------------------------------------- | ------------- |
| Active-cell vs transcript split                            | codex         |
| `experimental_throttle: 50` on useChat                     | vercel/ai     |
| React.memo on every part renderer                          | (everywhere)  |
| Memoized `<PriorMessages>` with `(length, last id)` equality| (everywhere)  |
| Streamdown's incremental-block parse                       | vercel/ai     |
| Structural equality on store updates                       | t3code        |
| Frame-batched repaints (TUI) ↔ throttled DOM (web)         | codex / vercel|
| Don't virtualize until measured pain                       | (everywhere)  |

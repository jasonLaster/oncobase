# Chat Performance — Implementation Plan

Phased plan for the work described in [chat-performance.md](./chat-performance.md). Each phase is shippable, reversible, and measurable on its own. The QA gates in [chat-performance-testing.md](./chat-performance-testing.md) must pass at each phase boundary before merging the next.

## In this plan
- [Sequencing principles](#sequencing-principles)
- [Phase 0 — Instrumentation](#phase-0--instrumentation)
- [Phase 1 — Server cadence (smoothStream + flusher)](#phase-1--server-cadence-smoothstream--flusher)
- [Phase 2 — Native parts model in Convex](#phase-2--native-parts-model-in-convex)
- [Phase 3 — Adopt useChat for the active tab](#phase-3--adopt-usechat-for-the-active-tab)
- [Phase 4 — Memoized message tree](#phase-4--memoized-message-tree)
- [Phase 5 — Streamdown for streaming markdown](#phase-5--streamdown-for-streaming-markdown)
- [Phase 6 — ai-elements Conversation + PromptInput](#phase-6--ai-elements-conversation--promptinput)
- [Phase 7 — Server-side correctness and caching](#phase-7--server-side-correctness-and-caching)
- [Phase 8 — Hardening and polish](#phase-8--hardening-and-polish)
- [Phase 9 — Optional virtualization](#phase-9--optional-virtualization)
- [Risk register](#risk-register)
- [Rollback strategy](#rollback-strategy)

## Sequencing principles

1. **Measure before, measure after.** Phase 0 puts the gates in place. No later phase merges without showing a budget improvement (or a documented neutral change).
2. **Backend before frontend where possible.** Server cadence work (Phase 1) and the parts schema (Phase 2) unblock the bigger frontend phases without forcing a UI rewrite.
3. **One transport at a time.** Phase 3 swaps to `useChat` for the active tab. We do not add ai-elements or Streamdown until the new transport is stable, otherwise rollback is hard to scope.
4. **Each PR is reversible.** Every phase keeps the prior code path behind a flag (`process.env.NEXT_PUBLIC_CHAT_*` or a Convex feature switch) until the next phase lands.
5. **No virtualization until we measure pain.** Phase 9 is conditional on real user threads exceeding our memoized-list budget.

## Phase 0 — Instrumentation

Goal: capture the metrics that govern the budget table in [chat-performance.md](./chat-performance.md).

Work:
- Add a `useChatPerf()` hook in [chat-interface.tsx](src/app/(main)/chat/_components/chat-interface.tsx) that tracks first-token latency, tokens/sec, commits/sec (via a render counter), and stale-stream events. Emit a `chat.perf` event to the existing telemetry sink. Dev mode logs to console only.
- Add a `chat-perf` Playwright project under [e2e/](e2e/) that runs the canonical scenarios from [chat-performance-testing.md](./chat-performance-testing.md) with CDP performance traces enabled.
- Add a tiny `bun scripts/chat-bench.ts` that hits `/api/chat` directly with a fixed prompt and records the time-to-first-byte and tokens/sec for the route alone.
- Capture a baseline run for each metric in [chat-performance-testing.md](./chat-performance-testing.md) → "Baseline" column. Commit the JSON.

Artifacts shipped:
- `web/src/lib/chat/perf.ts` — small typed sink, no runtime cost in prod beyond a sampled `performance.mark`.
- `web/e2e/chat-perf.spec.ts` — Playwright scenarios.
- `web/scripts/chat-bench.ts` — CLI bench.

Not in this phase: any change to render path, transport, or schema.

Exit gate:
- The four scenarios in [chat-performance-testing.md](./chat-performance-testing.md) §"Baseline scenarios" run green and produce a JSON dump.
- The baseline dump matches the "Today (measured)" column in [chat-performance.md](./chat-performance.md). If it does not, update the spec.

## Phase 1 — Server cadence (smoothStream + flusher)

Goal: smooth the token cadence the client receives, and centralize Convex writes.

Work:
- Add `experimental_transform: smoothStream({ delayInMs: 25, chunking: 'word' })` to the `streamText` call in [route.ts](src/app/api/chat/route.ts).
- Extract `createConvexFlusher(conversationId, { intervalMs: 250 })` to `web/src/app/api/chat/_flusher.ts`. It owns:
  - one `setInterval` at 250ms (down from 500ms),
  - a coalesced text buffer,
  - a tool-call buffer that flushes on the next tick (no more `flushNow` immediate writes),
  - a single `finalize(messages)` call on `onFinish` that writes once and clears the streaming row.
- Replace the inline `updateStreaming` / `flushNow` calls in `route.ts` with the flusher.

Artifacts shipped:
- `web/src/app/api/chat/_flusher.ts` (~120 LOC).
- `web/src/app/api/chat/route.ts` slimmed by the inline flush logic.

Not in this phase: schema change to `streamingParts` (still a JSON string until Phase 2), or anything client-side beyond the existing render path.

Exit gate:
- `chat-bench.ts` shows tokens/sec on the SSE response within 5% of pre-change.
- Token cadence in the rendered output is visibly smoother on a slow-network throttle profile (manual QA).
- Convex write rate to `conversations` drops from ~10/s to ~4/s during streaming (`bun convex logs` sample).

## Phase 2 — Native parts model in Convex

Goal: stop JSON-encoding the streaming parts.

Work:
- Add a typed `convex/chat/types.ts` mirroring the `ChatUIMessage` parts described in [chat-performance.md](./chat-performance.md#message--parts-model).
- Migrate `conversations.streamingParts` from `string` (JSON-encoded) to `array(Part)` in [convex/schema.ts](convex/schema.ts).
- Migrate `messages.parts` from a JSON string to a typed array in the same schema change.
- Add a one-shot Convex migration (`convex/migrations/0007_native_parts.ts`) that reads existing rows, parses their JSON strings, writes them back as arrays, and deletes any malformed rows safely (logging counts).
- Update the flusher and `saveMessages` to write the typed shape directly. Drop `JSON.stringify` and the client-side `JSON.parse`.

Artifacts shipped:
- Updated `convex/schema.ts`.
- New migration script with a dry-run flag.
- Updated `web/src/app/api/chat/_flusher.ts` and `convex/conversations.ts`.

Not in this phase: any change to the *frontend* render path. The frontend keeps reading the parts array (formerly parsed from JSON, now read directly).

Exit gate:
- Migration completes on a copy of prod data with zero malformed rows. (`bun scripts/migrate-dry-run.ts` reports counts.)
- A 50-message thread shows ≥1ms drop in average commit time (no JSON.parse in the render path).
- No regression in any QA scenario.

## Phase 3 — Adopt useChat for the active tab

Goal: stream tokens to the active tab over SSE, not via Convex round-trip.

Work:
- Update `web/src/app/api/chat/route.ts` to return `result.toUIMessageStreamResponse({ generateId })`. The existing Convex flusher still runs as a side effect.
- Replace the manual `fetch("/api/chat")` + Convex subscription block in [chat-interface.tsx](src/app/(main)/chat/_components/chat-interface.tsx) with `useChat({ api: '/api/chat', id: conversationId, experimental_throttle: 50, initialMessages, transport: new DefaultChatTransport({ ... }) })`.
- Keep the Convex `useQuery` subscription, but only consume it when `useChat`'s `status === 'ready'` and the local message list is behind. This is the cross-tab catch-up surface, not the live stream.
- Wire abort: `useChat({ ... }).stop()` for the local stream; the route's existing `req.signal` already stops the model on disconnect.
- Generate ids with `createIdGenerator({ prefix: 'msg' })` on both the client (for optimistic user messages) and the server (for assistant messages).

Artifacts shipped:
- `web/src/app/(main)/chat/_components/chat-client.tsx` (new, holds `useChat`).
- Slimmed `chat-interface.tsx` (now mostly composition).

Not in this phase: memoization, Streamdown, or ai-elements adoption. The render path stays the same shape.

Exit gate:
- First-token latency drops to ≤700ms on the chat-bench scenario.
- Cross-tab catch-up demo: open the same thread in two windows, send from window A, window B sees tokens within 500ms (slightly behind A but not stuck).
- Mid-stream refresh in window A resumes from the Convex mirror within 300ms.

## Phase 4 — Memoized message tree

Goal: stop re-rendering prior messages on every token.

Work:
- Split message rendering into:
  - `<PriorMessages>` — `React.memo` over the array, equality check `prev.length === next.length && prev[prev.length - 1].id === next[next.length - 1].id`.
  - `<StreamingMessage>` — reads only the last message; this is the only thing that re-renders during streaming.
- Wrap each user/assistant row in `React.memo` keyed on `message.id`. Render once per message lifetime; if a message is edited, increment a `version` counter on it.
- Wrap each part renderer (`<MessageMarkdown>`, `<ReasoningBlock>`, `<ToolCallBlock>`, `<SearchResultsBlock>`, `<ReadPageBadge>`, `<SourceLinks>`) in `React.memo` with referential equality on `part`. The parts array is rebuilt by `useChat`, but the references inside are stable for completed parts.
- Move the auto-scroll effect into the streaming-message subtree so it does not run on every state change in the parent.

Artifacts shipped:
- `web/src/app/(main)/chat/_components/messages.tsx` — `<PriorMessages>` + `<StreamingMessage>`.
- `web/src/app/(main)/chat/_components/message-row.tsx` — memoized row.
- `web/src/app/(main)/chat/_components/parts/*.tsx` — one file per part renderer.

Not in this phase: changes to the markdown engine or the auto-scroll contract beyond moving where it lives.

Exit gate:
- React DevTools profiler shows zero commits to `<PriorMessages>` while streaming a new assistant message.
- Commits/sec in the streaming scenario drops to ≤20/s.
- Steady-state FPS in the 50-message scenario rises to ≥55fps.

## Phase 5 — Streamdown for streaming markdown

Goal: replace `react-markdown` for streaming text with `streamdown`, which handles partial fences/tables and is hardened by default.

Work:
- `bun add streamdown`.
- Port wikilink resolution and citation preprocessing from `markdown-renderer-client.tsx` into Streamdown plugins:
  - `remarkWikilinks` — runs `resolveWikilinks` on text nodes.
  - `remarkCitations` — preprocess `[[…]]` and `[n]` style citations.
- Replace the `<MarkdownRenderer>` used inside `<MessageMarkdown>` with `<Streamdown content={...} components={overrides} plugins={...} />`.
- Verify katex/math still renders. If Streamdown's math plugin diverges from our existing config, document the diff in [chat-performance-qa.md](./chat-performance-qa.md) (created during Phase 0 testing).
- Keep the existing `<MarkdownRenderer>` for **persisted** assistant messages until we are confident in Streamdown — gated behind `NEXT_PUBLIC_CHAT_STREAMDOWN=1` for one release.

Artifacts shipped:
- `web/src/components/chat/markdown.tsx` — thin wrapper over `<Streamdown>`.
- Two ported remark plugins under `web/src/lib/markdown/`.
- Tailwind `@source` directive added for `streamdown/dist/*.js` per the Streamdown skill.

Not in this phase: any change to non-chat consumers of `<MarkdownRenderer>`. They keep `react-markdown`.

Exit gate:
- Visual regression: the screenshot suite in [chat-performance-testing.md](./chat-performance-testing.md) §"Markdown gallery" matches within tolerance.
- Streaming code blocks no longer flicker on partial fences.
- XSS suite passes (the existing one plus Streamdown's hardening).

## Phase 6 — ai-elements Conversation + PromptInput

Goal: replace hand-rolled scroll pin and composer with the supported primitives.

Work:
- `npx ai-elements@latest add conversation prompt-input`. Components land under `web/src/components/ai-elements/`.
- Replace the scroll container + `isNearBottomRef` + `showScrollButton` block with `<Conversation>` + `<ConversationContent>` + `<ConversationScrollButton>`.
- Replace `<GrowingTextarea>` + the surrounding form with `<PromptInput>` + `<PromptInputTextarea>` + `<PromptInputSubmit>`. Add explicit IME composition handling: ignore `Enter` while `e.nativeEvent.isComposing` is true.
- Wire `status` from `useChat` to `<PromptInputSubmit disabled={status !== 'ready'} />`. Show the existing `Stop` button when `status === 'streaming'` and call `useChat().stop()` on click.

Artifacts shipped:
- `web/src/app/(main)/chat/_components/composer.tsx` (new).
- Removed `growing-textarea.tsx` (with a moment of silence).

Not in this phase: any other ai-elements adoption (`<Tool>`, `<Reasoning>`, `<CodeBlock>`). We will stage those once these two prove out.

Exit gate:
- Scroll pin: when at bottom, new tokens keep us pinned; when scrolled up, a "new messages" pill appears and the page does not auto-scroll. Manual QA per [chat-performance-testing.md](./chat-performance-testing.md) §"Scroll contract".
- IME: composing Japanese with Google IME does not submit on Enter mid-composition.
- Mobile: iOS Safari keyboard does not push the composer offscreen.

## Phase 7 — Server-side correctness and caching

Goal: cut needless work in `route.ts` and make saves idempotent.

Work:
- Memoize `buildSystemPrompt` by `(conversationId, diagnosisVersion, pageIndexVersion)` for `MAX_AGE_MS = 60_000`. The Convex queries that feed it remain unchanged; we just avoid re-running them on every message in a hot conversation.
- Adopt `createIdGenerator({ prefix: 'msg' })` for both streaming and persisted ids; pass it to `toUIMessageStreamResponse({ generateId })`.
- Make `saveMessages` idempotent by `(conversationId, messageId)`. The Convex mutation should `upsert`, not `insert`.
- Add a tiny `requestId` to every streamed response and log it on `onFinish`, `onError`, and any 30s stale-stream watchdog event so we can correlate.

Artifacts shipped:
- `web/src/lib/chat/system-prompt-cache.ts`.
- Updated `convex/conversations.ts` mutations.

Not in this phase: changes to tool implementations or to the prompt content.

Exit gate:
- A second turn in a hot conversation skips the diagnosis + page index Convex queries (verified via `bun convex logs`).
- Replaying a saved request twice produces zero duplicate messages.

## Phase 8 — Hardening and polish

Goal: close the smaller items called out in the spec.

Work:
- Add an LRU cap (20 entries) to the module-level `messageCache` in `[id]/client.tsx`. Implement using a small `Map` + `delete`-on-set pattern; no library.
- Debounce the auto-resume effect in `chat-interface.tsx` so a fast double-mount in dev does not fire twice. Use a `sessionStorage` key keyed on `conversationId + lastUserMessageId`.
- Add an explicit `aria-live="polite"` region on `<ConversationContent>` (already present in ai-elements, but verify our styling does not hide the announcement).
- Add `prefers-reduced-motion` checks to the bouncing dots and the streaming-cursor pulse.
- Audit `console.warn` calls left in the codebase (`[chat-scroll]`, `[chat-stream]`); guard them on `NEXT_PUBLIC_DEBUG_CHAT=1` so prod is silent.

Exit gate:
- Long-session memory probe: after navigating across 50 conversations, `messageCache.size` is bounded at 20.
- Lighthouse accessibility on `/chat/[id]` ≥ 95.

## Phase 9 — Optional virtualization

Conditional: only ship if the [chat-performance-testing.md](./chat-performance-testing.md) §"Long thread" scenario regresses below the FPS budget at >200 messages.

Work:
- Adopt `@tanstack/react-virtual` over `<PriorMessages>`. The streaming message stays unvirtualized.
- Calibrate item-size estimation against the markdown blocks we render in practice (not a fixed `estimateSize`).
- Verify scroll pin still works with virtualization (use-stick-to-bottom needs the right scroll container).

Exit gate:
- A 500-message scenario sustains ≥55fps streaming.
- No regression on shorter threads.

## Risk register

| Risk                                                            | Likelihood | Impact | Mitigation                                                                            |
| --------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------- |
| `useChat` v6 ↔ AI SDK v6 API drift mid-implementation           | low        | medium | Pin both versions in package.json; bump deliberately between phases.                  |
| Streamdown wikilink/citation port loses fidelity                | medium     | medium | Phase 5 gated behind a flag; visual regression suite required to flip it on.          |
| Convex schema migration on `parts` corrupts existing messages   | low        | high   | Migration runs in dry-run first, writes a backup table, and is reversible for 7 days. |
| `experimental_throttle` + Convex mirror desync after reconnect  | medium     | medium | Reconnect path explicitly favors Convex mirror over local state for one tick.         |
| ai-elements primitive changes break our composition             | low        | medium | Components are copied into our repo on install; we own them.                          |
| Smooth-stream slows perceived speed on already-fast prompts     | medium     | low    | `delayInMs: 25` is configurable; A/B in dev before enabling in prod.                  |

## Rollback strategy

Each phase ships behind a kill switch:

- Phase 1: `CHAT_FLUSHER_INTERVAL_MS` env var. Revert to 500ms by setting it.
- Phase 2: schema migration is forward-compatible. We keep the `string` column for one release and dual-write for a week before removing it.
- Phase 3: `NEXT_PUBLIC_CHAT_TRANSPORT=convex|sse`. Default to `sse` after Phase 3, keep `convex` working for one release as the rollback.
- Phase 4: pure refactor; rollback by reverting the PR.
- Phase 5: `NEXT_PUBLIC_CHAT_STREAMDOWN=1`. Off by default in the first release.
- Phase 6: `NEXT_PUBLIC_CHAT_AI_ELEMENTS=1`.
- Phase 7: caching is bounded by TTL; in the worst case it serves a 60s-stale system prompt. No kill switch needed.
- Phase 8: pure refactors.
- Phase 9: feature flag `NEXT_PUBLIC_CHAT_VIRTUALIZE=1`.

A full rollback to today's behavior is one PR revert + a single `vercel env` flip, no schema rollback required.

# Current-State Audit vs Pattern Library

What our chat does today, what it doesn't, and where each pattern is implemented (or missing). Cross-references to the per-concept docs.

## Methodology

Reviewed every file under:
- `apps/web/src/app/(main)/chat/` (page, layout, [id]/, _components/)
- `apps/web/src/app/api/chat/` (route, _flusher, _system-prompt-cache)
- `apps/web/src/components/chat/` (streaming-markdown)
- `apps/web/src/components/ai-elements/` (vendored)
- `apps/web/src/lib/chat/` (perf)
- `convex/conversations.ts`, `convex/migrations.ts`, `convex/schema.ts`

Cross-referenced against the patterns in `00-overview.md` through `15-event-sourcing-projections.md`.

## Pattern-by-pattern table

Legend: ✓ have it, ◐ partial, ✗ missing, → ref

### 01 — Streaming architecture

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `streamText` with `experimental_transform: smoothStream` | ✓     | route.ts: `delayInMs: 25, chunking: 'word'` |
| `useChat({ experimental_throttle: 50 })`             | ✓     | chat-interface.tsx |
| `DefaultChatTransport` with `prepareSendMessagesRequest` | ◐     | We use it for conversationId injection but send the **full messages array** every time. Should send only the last message. |
| `Intl.Segmenter` for CJK chunking                    | ✗     | We use `'word'` only. Add for any non-English content. |
| Per-tool tool-input-streaming progressive render     | ✗     | We don't differentiate `input-streaming` from `input-available` in the UI. |

### 02 — Message + parts model

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| Discriminated parts (text/reasoning/tool-*/data-*)   | ◐     | We use AI SDK's `UIMessage`. Parts are typed by AI SDK; our renderers cast `unknown` because we don't define a `ChatTools` type parameter. |
| Typed `UIMessage<META, DATA, TOOLS>`                 | ✗     | Define `ChatMetadata`, `ChatDataParts`, `ChatTools`. |
| `data-*` parts for app data (sources, status)        | ✗     | We compute sources client-side from tool outputs. Move to server, emit as `data-source-pages`. |
| Parts stored as native arrays in DB (Phase 2 done)   | ✓     | Convex schema is `union(string, array)`; new writes use array. Migration script ready. |
| First-class reasoning parts                          | ◐     | `<ReasoningBlock>` exists but the model doesn't emit reasoning today. Wire on the day we switch to a reasoning model. |

### 03 — Tool-calling UX

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| Per-tool renderer (search_wiki, read_page, generic)  | ✓     | messages.tsx: `<SearchResultsBlock>`, `<ReadPageBadge>`, `<ToolCallBlock>`. |
| Render partial input during input-streaming          | ✗     | Both states fall through to "Searching X" / "Reading Y". |
| Reserve min-height per tool block                    | ✗     | Output landing causes ~20–80px shift. |
| Per-tool registry instead of if/else chain           | ✗     | If/else is fine for 5 tools; wouldn't scale to 20+. |
| Output-error state with retry affordance             | ✗     | We collapse errors into the generic block. |

### 04 — Agent loop

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| Multi-step with `stopWhen: stepCountIs(10)`          | ✓     | route.ts |
| `prepareStep` for token-budget escalation            | ✗     | No fallback when input tokens approach the limit. |
| `hasToolCall('final_answer')` stop condition         | ✗     | We rely on step count + model deciding to stop. |
| `ToolLoopAgent` abstraction                          | ✗     | We use `streamText` directly. |
| Auto-compact when context exhausts                   | ✗     | We just hit the wall. |
| UI step indicator during multi-step runs             | ✗     | The streaming block doesn't show "Step N / max". |

### 05 — Rendering performance

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `<PriorMessages>` memoized + `<StreamingMessage>` tail | ✓    | messages.tsx |
| `React.memo` on every part renderer                  | ✓     | messages.tsx |
| `useMemo` on the streaming-tail derivation           | ✓     | chat-interface.tsx |
| Streamdown for incremental markdown parsing          | ✓     | **Batch C landed.** Default-on; legacy fallback opt-in only. |
| Server emits sources as `data-*` parts (vs client derivation) | ✗ | Deferred — needs typed `UIMessage<META, DATA, TOOLS>` first. |
| `groupParts` and `extractSourcePages` memoized        | ✓     | **Batch C landed.** Both `useMemo`'d on `parts` ref. |
| Render-counter dev overlay                           | ✗     | The perf buffer infra exists; no UI yet. |

### 06 — Composer / input

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| ai-elements `<PromptInput>` compound                 | ✓     | chat-interface.tsx |
| IME-safe Enter (3-layer guard)                       | ✓     | Built into `<PromptInputTextarea>`. |
| `field-sizing-content` autosize textarea             | ✓     | Inside `<InputGroupTextarea>`. The legacy `<GrowingTextarea>` is now unused. |
| Slash commands via cmdk                              | ✗     | Deferred to a follow-up batch. |
| Voice input                                          | ✗     | Defer. |
| Persist composer drafts to sessionStorage            | ✓     | **Batch E landed.** Keyed by `chat:draft:${conversationId}`. |
| Up arrow on empty composer recalls last user message  | ✓     | **Batch E landed.** `handleComposerKeyDown`. |
| Esc aborts active stream                             | ✓     | **Batch E landed.** `handleComposerKeyDown` → `handleStop`. |
| Cmd/Ctrl+/ focuses composer                          | ✓     | **Batch E landed.** Global keydown listener. |
| Don't disable textarea during streaming              | ✓     | We disable submit button only. |

### 07 — Scroll pin

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `<Conversation>` (use-stick-to-bottom under the hood) | ✓     | chat-interface.tsx |
| `<ConversationScrollButton>` pill                    | ✓     | ai-elements default |
| `resize="smooth"` for sidebar toggles                | ✓     | ai-elements default |
| `role="log"` + `aria-live="polite"`                  | ✓     | We override `aria-live` on `<ConversationContent>`. |
| "N new messages" pill (count-based)                  | ✗     | We just have an arrow-down icon. |
| Scroll-position memory across thread switches        | ✗     | Reopens at top. |

### 08 — Markdown rendering

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `react-markdown` with gfm + math + raw + katex       | ✓     | markdown-renderer-client.tsx |
| Wikilinks + citations as string preprocess           | ✓     | resolveWikilinks + preprocessCitationMarkdown |
| Streamdown with `parseIncompleteMarkdown`            | ◐     | Behind a flag; off by default. |
| Custom `<CodeBlock>` with copy button                | ✗     | We use Streamdown's default code rendering. |
| Streaming caret indicator                            | ✗     | Not configured. |
| Mermaid diagrams                                     | ✗     | Not enabled. |
| Sanitize-by-default                                  | ◐     | `react-markdown` + `rehype-raw` allows raw HTML. Streamdown sanitizes; flip it on. |

### 09 — Persistence + resumption (NAVIGATION RESILIENCE)

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| Convex flusher writes mirror on every chunk          | ✓     | _flusher.ts (250ms ticks, coalesced) |
| Server-generated `messageId` for idempotent saves    | ✓     | route.ts: `createIdGenerator({ prefix: 'msg' })` |
| Idempotent `saveMessages` (skip if `messageId` seen) | ✓     | conversations.ts |
| 30s stale-stream watchdog                            | ✓     | chat-interface.tsx |
| `consumeSseStream` + `after()` keep function alive past disconnect | ✓ | **Batch A landed.** route.ts drains the tee'd stream via `after()`. |
| Decoupled abort signal (`userStopSignal` ≠ `req.signal`)  | ✓ | **Batch A landed.** Explicit `AbortController`; `req.signal` no longer kills the model. |
| `canceledAt` column + `cancelStream`/`clearCancel`/`getCancelState` mutations | ✓ | **Batch A landed.** Stop button writes the flag; route polls at 1Hz. |
| `useChat({ resume: true })` for SSE replay           | ◐     | Deferred. Convex mirror serves as recovery surface in lieu of `resumable-stream`/Redis. |
| GET `/api/chat?id=…` SSE replay endpoint             | ◐     | Deferred (would require `resumable-stream` + Redis/KV). Mirror covers our use case. |

### 10 — Error / abort / disconnect

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `onError` distinguishes auth/credits/general         | ✓     | route.ts inline |
| `onAbort` saves partial via `finalizeAbort`          | ✓     | _flusher.ts |
| `onFinish` saves final + clears stream               | ✓     | _flusher.ts |
| Two-signal abort (user stop vs disconnect)           | ✗     | See 09 above. |
| Toast for transient errors (network)                 | ✗     | We surface inline only. |
| Inline retry affordance on error blocks              | ✗     | Error blocks are read-only. |
| Typed `code` on error responses (auth/credits/...)   | ✗     | Plain string error. |
| Special context-limit handler                        | ✗     | No compact-and-retry. |
| `aria-live="assertive"` only for genuine alerts      | ✓     | We use polite throughout. |

### 11 — Approval workflow

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `state: 'approval-requested'` on tool parts          | ✗     | No tools currently need it. |
| `<ApprovalCard>` component                           | ✗     | — |
| `addToolApprovalResponse` plumbing                   | ✗     | — |
| `acceptForSession` decision                          | ✗     | — |
| Server-side approval gate                            | ✗     | — |

(Whole row is missing because no destructive tools today. Build the protocol before we need it.)

### 12 — Multi-tab / cross-window

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| Convex reactive query as cross-tab sync layer        | ✓     | useQuery(api.conversations.get) |
| Active tab uses useChat (SSE); inactive tabs use mirror | ✓ | `<CrossTabStream>` in chat-interface.tsx |
| Sync useChat from Convex when ready + Convex longer  | ✓     | chat-interface.tsx |
| Bidirectional sync (also when Convex is shorter)     | ✗     | Edits don't propagate to other tabs. |
| Resumable stream as multi-observer                   | ✗     | See 09. |
| BroadcastChannel for leader election (watchdog)      | ✗     | Both tabs fire watchdog. Harmless but wasteful. |
| "Active in another tab" indicator                    | ✗     | — |

### 13 — Component composition

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| ai-elements `<Conversation>` + `<PromptInput>` compounds | ✓ | chat-interface.tsx |
| `<Message>` compound (Header/Content/Footer)         | ◐     | Per-message actions added inline; full compound deferred. |
| CVA for variants on message bubbles + tool blocks    | ✗     | Inline class ternaries (cosmetic). |
| `data-slot` on every chat component                  | ◐     | ai-elements components yes; new `data-slot="assistant-message"` etc. added in Batch D. |
| `<Toaster />` (Sonner)                               | ✓     | **Batch F landed.** Mounted in chat layout (not root, to avoid cmdk-portal collisions). |
| Per-message Copy + Regenerate                        | ✓     | **Batch D landed.** Hover-revealed actions on committed assistant messages. |

### 14 — Accessibility

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| `role="log"` + `aria-live="polite"` on message list  | ✓     | chat-interface.tsx + ai-elements |
| `role="status"` on submit-pending dots               | ✓     | chat-interface.tsx |
| `motion-reduce:` on animations                       | ✓     | Bouncing dots |
| autoFocus on composer                                | ✓     | `<PromptInputTextarea>` |
| Cmd+B sidebar toggle                                 | ✓     | shadcn sidebar |
| Cmd+/ to focus composer                              | ✗     | — |
| Up-arrow to edit last user message                   | ✗     | Pencil icon is mouse-only. |
| Esc to abort active stream                           | ✗     | Stop button only. |
| Live region for tool status changes                  | ✗     | Tools update visually only. |
| axe-core in CI                                       | ✗     | We only have manual checks. |

### 15 — Event sourcing + projections

| Pattern                                              | Status | Notes |
| ---------------------------------------------------- | :----: | ----- |
| Event log as source of truth                         | ✗     | Defer (complexity not justified). |
| `data-*` parts as lightweight projection signals     | ✗     | Adopt for sources. |
| Command log (high-level intents)                     | ✗     | Defer. |

## Top-line summary

**Strengths after Batches A + C + D + E + F**

- Server-side navigation resilience: route runs to completion regardless of client connection. `consumeSseStream` + `after()` drain past disconnect; `userStopSignal` is decoupled from `req.signal`; `cancelStream` mutation drives an explicit-only abort. Verified by automated and manual smoke.
- The persistence + flusher architecture remains solid (Convex mirror writes every 250ms; idempotent `saveMessages` via server-generated `messageId`; 30s stale-stream watchdog).
- ai-elements integration is clean: `<Conversation>`, `<PromptInput>`, `<PromptInputSubmit status onStop>`.
- Memoized prior list + streaming tail (Phase 4) plus newly-memoized `groupParts` and `extractSourcePages` keep the streaming-tail render budget tight.
- Streamdown is the default markdown renderer; partial fences and tables render gracefully mid-stream.
- Per-message Copy + Regenerate; Sonner toaster scoped to the chat layout.
- Composer drafts persist; Up arrow recalls; Esc aborts; Cmd/Ctrl+/ focuses.

**Remaining gaps (deferred)**

| Item                                                 | Reason for deferral                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Typed `UIMessage<META, DATA, TOOLS>`                 | Cleanup work; doesn't change behavior.                              |
| Server-emitted `data-source-pages` parts             | Wants the typed UIMessage first.                                    |
| `useChat({ resume: true })` + GET replay             | Needs `resumable-stream` + Redis/KV; Convex mirror covers our use case today. |
| Slash commands palette                               | Standalone feature; not blocking.                                  |
| Approval workflow skeleton                           | Defer until first destructive tool lands.                          |
| `<Message>` compound (Header/Content/Footer)         | Cosmetic.                                                          |
| CVA for variants                                     | Cosmetic.                                                          |
| axe-core in CI                                       | Add when we have a tighter accessibility loop.                     |
| Render-counter dev overlay                           | Phase 0 buffer is already there; just needs a UI.                  |
| "N new messages" pill                                | Add if threads get long.                                            |

See [IMPROVEMENTS.md](./IMPROVEMENTS.md) for the original 10-batch plan and what landed.

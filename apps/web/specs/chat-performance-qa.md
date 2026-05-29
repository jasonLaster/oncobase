# Chat Performance — Measured QA Results

Per-phase measurement log for the chat performance plan ([chat-performance.md](./chat-performance.md), [chat-performance-plan.md](./chat-performance-plan.md), [chat-performance-testing.md](./chat-performance-testing.md)).

This is a **living document**. Each phase appends a row with the metrics captured by `bun playwright test e2e/chat-perf.spec.ts` and `bun scripts/chat-bench.ts --baseline`.

## How to capture

Local (against `bun dev`):

```sh
# 1. Server-side bench (TTFB + bytes/sec on /api/chat)
bun scripts/chat-bench.ts --baseline

# 2. Browser perf scenarios (writes apps/web/e2e/.perf/P0-*.json)
bun playwright test e2e/chat-perf.spec.ts --project=tests
```

CI: `e2e/chat-perf.spec.ts` runs with `apps/web/e2e/.perf/baseline.json` as the gate. Failures land in `apps/web/e2e/__diff_output__/`.

## Phase 0 baseline

Status: **awaiting first run against a live env.** All instrumentation infrastructure lands in this branch. The worktree this PR was authored in had no `.env.local` (no Convex deployment, no AI Gateway key), so the actual numbers below are populated by the first person to run the suite against a live env.

Static QA that already passed in this branch:

- `bun run typecheck` — clean at every phase boundary.
- `bun run lint` — clean at every phase boundary.
- `bun run test:unit` — 29 passing tests, 0 failures.
- `bun run build` — succeeds; only pre-existing NFT warning in `next.config.ts`, unrelated to chat.

Deferred until a live env is available:

- `bun scripts/chat-bench.ts --baseline`
- `bun playwright test e2e/chat-perf.spec.ts --project=tests`
- The functional regression matrix in [chat-performance-testing.md](./chat-performance-testing.md) §"Functional regression matrix".
- The IME, scroll contract, and cross-tab manual scenarios.

When the suite runs, paste the JSON dumps from `apps/web/e2e/.perf/` here and update the rows below.

| Scenario | TTFB (ms) | Tokens/s | FPS (steady) | Commits/s | Recovery (ms) | Captured at |
| -------- | --------- | -------- | ------------ | --------- | ------------- | ----------- |
| P0-A empty thread, short answer        | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-B empty thread, tool-heavy          | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-C 50-message follow-up              | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-D 200-message follow-up             | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-E slow 3G                           | TBD | TBD | TBD | TBD | n/a  | TBD |
| P0-F refresh mid-stream                | TBD | n/a | n/a | n/a | TBD  | TBD |
| P0-G abort + resend                    | TBD | n/a | n/a | n/a | n/a  | TBD |

Once captured, paste the JSON dumps from `apps/web/e2e/.perf/` here and update the Phase 0 row in the table.

## Per-phase results

Each phase appends the same scenario rows after running the suite. Format matches the table above. Diff vs baseline is computed by `bun scripts/chat-bench.ts --compare`.

### Phase 1 — server cadence

Code: `apps/web/src/app/api/chat/_flusher.ts` (new), `apps/web/src/app/api/chat/route.ts` (smoothStream + flusher delegation).

Static QA: clean.

Live measurement pending. Manual sanity checks on the spec scenarios:
- Convex write rate under streaming should drop from ~10/s to ~4/s (250ms tick + coalesced text).
- Tool-call mirror latency goes from "immediate" to "≤250ms" on the next tick. Functionally invisible.
- Token cadence should look smoother on a Slow 3G profile.

### Phase 2 — native parts in Convex

Code: schema union(string, array), migration script + Convex functions, flusher writes arrays, client reads both.

Static QA: clean. Schema migration is forward-compatible — old rows still validate.

To deploy:

```sh
bunx convex dev   # codegen for api.migrations.*
bun scripts/migrate-native-parts.ts            # dry run; should report messagesNeedingMigration > 0
bun scripts/migrate-native-parts.ts --apply    # actually migrate
```

### Phase 3 — useChat over SSE

Code: `chat-interface.tsx` rewritten around `useChat({ transport: DefaultChatTransport, experimental_throttle: 50 })`. Convex mirror retained as cross-tab + recovery surface.

Static QA: clean.

Live perf expectation: TTFB drops to whatever the AI Gateway / model produces (was bounded by 250ms Convex round-trip before; SSE is direct).

### Phase 4 — memoized message tree

Code: split into `messages.tsx` with `<PriorMessages>` (memoized list) and `<StreamingMessage>` (per-token re-render). Each part renderer wrapped in `React.memo`.

Static QA: clean.

Verification still owed: React DevTools Profiler showing zero `<PriorMessages>` commits during streaming.

### Phase 5 — Streamdown

Code: `apps/web/src/components/chat/streaming-markdown.tsx`, behind `NEXT_PUBLIC_CHAT_STREAMDOWN=1`.

Status: feature-complete, **flag off by default**. Default path remains `MarkdownRendererClient`. Flip the flag in a follow-up release after the markdown gallery snapshot suite confirms parity.

### Phase 6 — `<Conversation>` + `<PromptInput>` from ai-elements

Code: scaffolded via `bunx ai-elements@latest add conversation prompt-input` — components live in `src/components/ai-elements/` plus the shadcn ui deps in `src/components/ui/`. The chat shell now composes `<Conversation>` / `<ConversationContent>` / `<ConversationScrollButton>` / `<ConversationEmptyState>` and `<PromptInput>` / `<PromptInputBody>` / `<PromptInputTextarea>` / `<PromptInputFooter>` / `<PromptInputSubmit>`.

Status: feature-complete. The submit ↔ stop transition now drives off `useChat`'s `status` field via `<PromptInputSubmit status={status} onStop={handleStop}>`. IME-safe Enter is handled internally by `<PromptInputTextarea>` (tracks both React composition events and `e.nativeEvent.isComposing`).

Manual QA still owed:
- Scroll: at-bottom pins, scrolled-up shows the ai-elements scroll pill, click returns to bottom.
- IME: Google Japanese composition does not submit on Enter mid-composition.

### Phase 7 — server caching + idempotency

Code: `apps/web/src/app/api/chat/_system-prompt-cache.ts` (60s TTL, single in-flight promise), `messages.messageId` + `by_message_id` index, idempotent `saveMessages`, `createIdGenerator`, `x-request-id` header + log prefix.

Static QA: clean.

Verification still owed: replaying the same `/api/chat` call twice creates one row, not two; system-prompt cache hit rate ≥80% in a 5-turn conversation.

### Phase 8 — hardening + polish

Code: bounded LRU on `messageCache` (cap 20), `sessionStorage`-debounced auto-resume, `motion-reduce` on the bouncing-dots animation, `role="log"` + `aria-live` on the message region.

Static QA: clean.

## Notes / gotchas worth remembering between phases

(empty until something surprises us)

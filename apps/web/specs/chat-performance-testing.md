# Chat Performance — Test Plan

QA material for the work described in [chat-performance.md](./chat-performance.md) and [chat-performance-plan.md](./chat-performance-plan.md). This document defines the scenarios we run, the budgets they enforce, and the matrix of regressions we watch for at each phase boundary.

The corresponding measured-results doc, `chat-performance-qa.md`, is created during Phase 0 and updated as each phase lands.

## In this plan
- [Test surfaces](#test-surfaces)
- [Performance budgets](#performance-budgets)
- [Baseline scenarios (Phase 0)](#baseline-scenarios-phase-0)
- [Per-phase exit gates](#per-phase-exit-gates)
- [Functional regression matrix](#functional-regression-matrix)
- [Markdown gallery](#markdown-gallery)
- [Scroll contract](#scroll-contract)
- [IME and keyboard](#ime-and-keyboard)
- [Network and recovery](#network-and-recovery)
- [Tool UX scenarios](#tool-ux-scenarios)
- [Accessibility checklist](#accessibility-checklist)
- [Security checks](#security-checks)
- [Long-session and memory checks](#long-session-and-memory-checks)
- [Cross-tab and persistence checks](#cross-tab-and-persistence-checks)
- [Manual smoke matrix per phase](#manual-smoke-matrix-per-phase)
- [Tooling notes](#tooling-notes)

## Test surfaces

We run tests on three surfaces, in increasing cost:

1. **Vitest unit** — pure functions: parts grouping, citation preprocessor, wikilink resolver, system-prompt cache key, flusher coalescing logic.
2. **Convex tests** — the migration in Phase 2 runs against a fresh dev deployment with seed data. `bun convex run migrations:0007_native_parts:dryRun` must report `mismatched: 0`.
3. **Playwright** — a `chat-perf` project under `apps/web/e2e/`. Each scenario captures a CDP performance trace plus a JSON line written to `apps/web/e2e/.perf/`.
4. **Manual** — the matrices below for IME, mobile, scroll pin, and visual regressions.

A scenario fails if **any** of (a) functional assertion, (b) perf budget, or (c) accessibility budget is missed.

## Performance budgets

Mirror of the table in [chat-performance.md](./chat-performance.md), expanded with measurement detail.

| Metric                                       | Tool                  | How                                                                                       | Today  | Target  |
| -------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- | ------ | ------- |
| First-token latency                          | Playwright + CDP      | `submit()` → first `Network.responseReceived` chunk that contains a non-empty text delta. | 1100ms | ≤700ms  |
| Tokens/sec on the wire                       | `chat-bench.ts`       | bytes from the SSE response divided by elapsed time, normalized.                          | n/a    | ±5%     |
| Steady-state stream FPS, 50-message thread   | Playwright + CDP      | `Performance.metrics` averaged over 5s of active streaming.                               | ~28fps | ≥55fps  |
| React commits / sec during streaming         | `useChatPerf` counter | render counter on `<ChatClient>` minus on `<PriorMessages>` over 5s.                      | ~30/s  | ≤20/s   |
| Time-to-interactive after thread switch      | Playwright            | route change → first interactive paint of the composer.                                   | 1400ms | ≤500ms  |
| Mid-stream tab refresh recovery              | Playwright            | reload during streaming → first painted token from the recovered stream.                  | full   | ≤300ms  |
| Composer input lag while streaming           | Playwright + CDP      | `keypress` → `compositionupdate` paint. Must show no dropped frames.                      | jitter | none    |
| LCP of `/chat/[id]`                          | Lighthouse (CI)       | warm cache, 100-msg thread.                                                               | n/a    | ≤2.5s   |
| Accessibility score                          | Lighthouse (CI)       | `/chat/[id]` and `/chat`.                                                                 | n/a    | ≥95     |

Budgets are tracked in `apps/web/e2e/.perf/budget.json`. Playwright fails the run if a metric exceeds `budget * 1.1` (10% headroom).

## Baseline scenarios (Phase 0)

These are the canonical scenarios we run before and after every phase. They live in `apps/web/e2e/chat-perf.spec.ts`.

| ID    | Name                          | Setup                                              | Action                                          | Asserts                                |
| ----- | ----------------------------- | -------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| P0-A  | Empty thread, short answer    | new conversation                                   | "What is TNBC?"                                 | first-token, tokens/sec, FPS           |
| P0-B  | Empty thread, tool-heavy      | new conversation                                   | "Find pages tagged 'recurrence' and summarize." | tool state machine, no text flicker    |
| P0-C  | 50-message thread             | seeded fixture conversation                        | follow-up "Summarize the prior turn."           | FPS, commits/sec, prior-msg renders=0  |
| P0-D  | 200-message thread            | seeded fixture conversation                        | follow-up "Summarize the prior turn."           | FPS at-or-above ≥55, scroll pin holds  |
| P0-E  | Slow network (Slow 3G)        | CDP throttle = Slow 3G                             | "What is TNBC?"                                 | first-token ≤2.5s, no UI freeze        |
| P0-F  | Refresh mid-stream            | start P0-A, reload at +500ms                       | recovery completes                              | recovery ≤300ms, last assistant intact |
| P0-G  | Abort and resend              | start P0-A, click Stop, edit input, resend         | new stream                                      | no orphan stream, clean state          |

Fixture conversations are seeded by `bun scripts/seed-chat-fixtures.ts` (added in Phase 0) into a dev Convex deployment. Tests reset the fixture between runs.

## Per-phase exit gates

| Phase | Required to merge                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Baseline JSON committed; CI runs the full P0-A through P0-G suite green; budget table populated.                                 |
| 1     | P0-A tokens/sec within ±5% of baseline. P0-B shows smoother cadence on Slow 3G (manual). Convex write rate down ≥40%.            |
| 2     | Migration `mismatched: 0` on prod copy. P0-C commits/sec drop by ≥20% from no longer parsing JSON.                               |
| 3     | P0-A first-token ≤700ms. P0-F recovery ≤300ms. Cross-tab catch-up scenario passes (manual).                                      |
| 4     | P0-C and P0-D commits/sec ≤20/s. React DevTools shows zero `<PriorMessages>` commits during streaming.                           |
| 5     | Markdown gallery diff within tolerance. XSS suite passes. Streaming code blocks no longer flicker on partial fences.             |
| 6     | Scroll contract scenarios all pass. IME scenarios all pass. Mobile checklist passes on iOS Safari and Android Chrome.            |
| 7     | Idempotency: replaying a saved request twice creates 0 duplicates. System-prompt cache hit rate ≥80% on a 5-turn conversation.   |
| 8     | LRU bounded at 20 entries after 50 navigations. Lighthouse accessibility ≥95.                                                    |
| 9     | (Conditional) 500-message scenario at ≥55fps. No regression on P0-A through P0-G.                                                |

## Functional regression matrix

Functional behavior we must preserve at every phase. Each row is a Playwright assertion in `apps/web/e2e/chat-functional.spec.ts`.

| Area                  | Behavior                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Submit                | Empty input does not submit. Enter submits. Shift+Enter inserts newline. Cmd/Ctrl+Enter submits (if we keep it).  |
| Submit                | While streaming, the submit button reads "Stop" and aborts the active stream.                                     |
| User edit             | Hovering a user message shows the pencil icon. Clicking it loads the text and trims subsequent messages.          |
| Auto-resume           | Reloading on a thread whose last message is `user` and has no live stream re-triggers generation exactly once.    |
| Stale stream watchdog | A streaming row not updated for 30s clears, the trailing user message is marked disabled, the input unblocks.     |
| Tool: search_wiki     | Streaming the call shows the input phase, then a "Searching…" badge, then the results block expanded by default.  |
| Tool: read_page       | Spinning icon → "Read {title}" badge with a wiki link. Clicking the link opens the page.                          |
| Tool: list_pages      | Renders the generic ToolCallBlock with the page list.                                                             |
| Sources               | After `onFinish`, source pages are extracted from tool results and rendered under the message.                    |
| Citations             | `[1]`, `[2]` style references in the markdown link to the corresponding source.                                   |
| Wikilinks             | `[[Page Name]]` resolves to a wiki link with the slug; ambiguous links fall back gracefully.                      |
| Math                  | Inline `$x$` and block `$$…$$` render via katex.                                                                  |
| Code                  | ```` ```ts ```` blocks render with a language label and a copy button.                                            |
| Empty state           | The new-chat page shows the suggested questions list. Clicking one populates the input.                           |
| Error                 | A failed `/api/chat` response renders the error block and unblocks the input.                                     |

## Markdown gallery

A snapshot suite under `apps/web/e2e/markdown-gallery.spec.ts` renders fixed strings and screenshot-diffs them. New rows added during Phase 5 to lock in Streamdown parity.

| Fixture                     | What it covers                                                            |
| --------------------------- | ------------------------------------------------------------------------- |
| `prose.md`                  | headings, bold/italic, links, lists, blockquotes                          |
| `tables.md`                 | GFM tables with alignment + an oversize table that should scroll          |
| `code.md`                   | fenced code with language label, copy button, line break preservation     |
| `code-streaming.md`         | partially-closed fence (` ```ts\nconst x = ` ) — must not flicker         |
| `math.md`                   | inline `$…$`, block `$$…$$`, multiline matrices                           |
| `wikilinks.md`              | `[[Page]]`, `[[Page#section]]`, `[[Page|Alias]]`                          |
| `citations.md`              | `[1]`, `[2]` style citations referenced in a sources block                |
| `mixed.md`                  | a long answer that hits all of the above, used to time render             |

Tolerance: per-pixel diff with `maxDiffPixels: 200, threshold: 0.2`. Failures land in `apps/web/e2e/__diff_output__/`.

## Scroll contract

Manual + automated. The contract lives in [chat-performance.md](./chat-performance.md#component-tree-and-rendering-contract).

| Case                                                                                       | Expected                                                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| At bottom, assistant streams                                                               | Stays pinned at bottom; no jitter; no scroll button.                                      |
| Scrolled up while assistant streams                                                        | Page does **not** auto-scroll. "New messages" pill appears.                               |
| Click the pill                                                                             | Smoothly scrolls to bottom; pill disappears.                                              |
| At bottom, send a new user message                                                         | New message is visible; auto-scroll resumes for the assistant response.                   |
| Scrolled up, send a new user message                                                       | The user message is visible *because* it is at the top of the new content; pill persists. |
| Mid-stream resize the window                                                               | Pin holds; no scroll-jump.                                                                |
| Mid-stream switch the device theme (dark/light)                                            | Pin holds; no scroll-jump.                                                                |
| Mid-stream open the right comments rail                                                    | Pin holds; lane resizes; no scroll-jump.                                                  |
| User scrolls to the very top to read history                                               | Stays where placed; no auto-scroll.                                                       |

## IME and keyboard

The composer must not submit while an IME composition is in progress. We test with at least one CJK IME.

| Case                                                                  | Expected                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Google Japanese IME, type `ありがとう` and press Enter to commit candidate | Commits the candidate; **does not** submit.                                         |
| Press Enter again with the input populated                            | Submits.                                                                            |
| Shift+Enter while composing                                           | Inserts a newline after the composition commits; **does not** submit.               |
| Cmd/Ctrl+Enter while composing                                        | If we keep this binding, ignored while composing.                                   |
| Backspace while composing                                             | Deletes within the composition; never the whole input.                              |

Implementation reference: ignore `Enter` when `event.nativeEvent.isComposing === true` or `event.keyCode === 229`.

## Network and recovery

| Case                                                  | Expected                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Submit with offline → online toggle within 5s         | The fetch retries via `useChat`'s default reconnect; user sees a brief error state.   |
| Refresh mid-stream                                    | Recovery from Convex mirror within 300ms; assistant message completes from server.    |
| Server crashes mid-stream (simulated 500 mid-chunk)   | Stale-stream watchdog clears at 30s; trailing user message disabled.                  |
| Slow 3G profile                                       | First-token ≤2.5s; UI never freezes; composer remains responsive.                     |
| Two tabs of the same thread, send from tab A          | Tab B sees the assistant message within 500ms via the Convex mirror.                  |
| Two tabs of the same thread, send simultaneously      | The first one to reach the server wins; the second receives a 409 and shows an error. |
| Abort during a tool call                              | The active step is cancelled; the conversation returns to ready; no orphan tool row.  |

## Tool UX scenarios

The state machine described in [chat-performance.md](./chat-performance.md#message--parts-model). Each tool has a dedicated render assertion.

| Tool             | Visible states                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `search_wiki`    | input-streaming → spinner with the assembled query; output-available → expandable results panel.                                |
| `read_page`      | input-streaming → spinner with "Reading {slug}…"; output-available → "Read {title}" badge linking to the page.                  |
| `list_pages`     | input-available → spinner; output-available → ToolCallBlock with the page list.                                                 |
| `get_pages_by_tag` | input-available → spinner; output-available → ToolCallBlock with the matched pages.                                           |
| `list_tags`      | input-available → spinner; output-available → ToolCallBlock with the tag list.                                                  |

Layout-thrash check: streaming a long tool input must not push subsequent content; the tool block reserves a min-height matching its expanded shape.

## Accessibility checklist

Run as part of CI via Playwright + `@axe-core/playwright`.

- `<Conversation>` has `role="log"` and `aria-live="polite"`.
- The streaming-cursor pulse and bouncing dots respect `prefers-reduced-motion`.
- `<PromptInputSubmit disabled={true}>` has `aria-disabled="true"`, not just visually dimmed.
- The "Stop" button is reachable by keyboard and has a focus ring.
- Edit-message pencil button has an `aria-label`.
- The new-chat suggested-question buttons are reachable via Tab and have visible focus states.
- The "scroll to bottom" pill has an `aria-label="Scroll to bottom"`.
- Lighthouse accessibility score on `/chat/[id]` and `/chat` ≥ 95.
- Color contrast for citations and wikilinks ≥ 4.5:1 in both themes.

## Security checks

These run on every PR that touches markdown rendering, tool surfaces, or the API route.

- XSS smoke: render a fixture with `<script>`, `<img onerror>`, `javascript:` URLs, `<iframe>`, and `data:` images. None should execute. (Streamdown's `defaultRehypePlugins.sanitize` enforces this.)
- Wikilink injection: `[[../etc/passwd]]` and `[[https://evil.example.com]]` resolve to `null` or escape harmlessly.
- Citation injection: `[1](javascript:alert(1))` style markdown links must be rejected.
- Tool input leak: a streaming tool input that contains the raw system prompt must not render the system prompt in the UI.
- PII redaction continues to apply to the system prompt assembly path; verify with the existing PII test fixture.

## Long-session and memory checks

| Check                                                                  | How                                                          | Budget        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ | ------------- |
| `messageCache` size after 50 navigations                               | Manual + `window.__CHAT_DEBUG__.messageCache.size`           | ≤20           |
| Heap growth after 100 streamed messages in one session                 | Chrome Performance Memory recording                          | ≤20 MB        |
| Long thread (1000 messages, no virtualization)                         | Manual                                                       | Documented    |
| Long thread (1000 messages, virtualization on)                         | Manual                                                       | ≥55fps        |
| Composer focus survival across thread navigation                       | Playwright                                                   | Always focus  |

## Cross-tab and persistence checks

| Case                                                                  | Expected                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Send in tab A → tab B sees streaming text within 500ms                | Yes, via Convex mirror.                                                               |
| Tab A finishes → tab B's `messages` list updates from `messages` table | Yes, Convex reactive query.                                                            |
| Refresh tab A mid-stream                                              | Recovery from mirror; final state matches `messages` after `onFinish`.                |
| Replay the same `requestId` twice (force a retry)                     | One row in `messages`, one streaming clear, no duplicates.                            |
| Manually delete a message in Convex while streaming                   | UI shows a "this message was removed" placeholder; stream continues unaffected.       |

## Manual smoke matrix per phase

A short list of clicks every phase reviewer is expected to do before approving a PR.

1. New chat → ask a short question → see a clean stream end-to-end.
2. New chat → ask a tool-heavy question (e.g., "find all pages tagged 'recurrence'") → see tool blocks resolve in order.
3. Open an existing 50+ message thread → send a follow-up → confirm scroll pin and no re-render of the older messages (React DevTools Profiler).
4. Mid-stream, hit refresh → recovery completes.
5. Compose Japanese with an IME → confirm Enter does not submit during composition.
6. Open the same thread in two tabs → send from one → confirm the other receives the stream.
7. Throttle to Slow 3G → confirm UI stays responsive.
8. Toggle dark mode mid-stream → confirm no scroll-jump.

## Tooling notes

- Playwright config lives at [`../playwright.config.ts`](../playwright.config.ts). Add a `chat-perf` project that injects a flag enabling `useChatPerf`'s console output, then captures it via `page.on('console', …)`.
- Chrome DevTools Protocol traces are saved as `apps/web/e2e/.perf/<scenario>-<sha>.trace.json` so we can diff Performance panels across phases.
- The `chat-bench.ts` script accepts `--baseline` to write into `apps/web/e2e/.perf/baseline.json` and `--compare` to diff against it.
- Convex test deployment is provisioned by the local operator workflow. Tests reset their fixtures between runs.
- The visual regression suite uses Playwright's built-in `toMatchSnapshot`. Update snapshots with `bun playwright test --update-snapshots` and review the diff before committing.

For ongoing measured results (which numbers landed at which phase), see `chat-performance-qa.md` once Phase 0 is in progress.

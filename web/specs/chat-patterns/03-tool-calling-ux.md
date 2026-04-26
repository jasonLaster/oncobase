# Tool-Calling UX

Streaming a tool call from "the model decided to use this tool" through "the user can read its result" without blank space, layout thrash, or confusing transitions.

## The five (or six) states

```
                    ┌──────────────────┐
                    │     pending      │ ◀── tool dispatched, no input deltas yet
                    └────────┬─────────┘
                             │ first input chunk
                    ┌────────▼─────────┐
                    │ input-streaming  │ ◀── partial JSON arriving (best-effort parsed)
                    └────────┬─────────┘
                             │ JSON valid + complete
                    ┌────────▼─────────┐
                    │  input-available │ ◀── execute() will run (unless approval)
                    └────────┬─────────┘
                             │
              ┌──────────────┼─────────────────┐
              │              │                 │
              ▼              ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │approval-req. │  │  executing   │  │     skip     │
    └──────┬───────┘  └──────┬───────┘  └──────────────┘
           │ approve         │ tool returned
           ▼                 ▼
    ┌──────────────┐  ┌──────────────┐
    │approval-resp.│  │  output-     │
    └──────┬───────┘  │  available   │
           │ resume   └──────────────┘
           ▼          OR
    ┌──────────────┐  ┌──────────────┐
    │   resumed    │  │ output-error │
    └──────────────┘  └──────────────┘
```

## input-streaming — render the partial input progressively

`~/src/os/vercel-ai/packages/ai/src/generate-text/stream-text.ts:2279–2310`

The server emits `tool-call-start { id, toolName }` then a stream of `tool-call-delta { id, argsTextDelta }`. The client accumulates the partial JSON into the part's `input` (best-effort parsed), then on `tool-call` (full args) sets `state: 'input-available'`.

`~/src/os/vercel-ai/examples/next-agent/component/weather-view.tsx:8–29`

```tsx
function WeatherView({ invocation }: { invocation: ToolUIPart<typeof weatherTool> }) {
  switch (invocation.state) {
    case 'input-streaming':
      // partial JSON; show what we have so far, skeleton for unknowns
      return <Skeleton>Looking up {invocation.input?.city ?? '…'}…</Skeleton>;
    case 'input-available':
      return <RunningSpinner toolName="weather" args={invocation.input} />;
    case 'output-available':
      return <WeatherCard data={invocation.output} />;
    case 'output-error':
      return <ToolError text={invocation.errorText} retry={...} />;
    case 'approval-requested':
      return <ApprovalDialog onApprove={...} onDeny={...} args={invocation.input} />;
  }
}
```

Key UX rules:
1. **Reserve min-height** during `input-streaming` so the result block doesn't shift when it lands.
2. **Show the user the input** as it arrives. A spinner with no context is bad UX; a spinner with "Searching for 'KEYNOTE-522'" is honest progress.
3. **Don't try to parse incomplete JSON yourself.** AI SDK's `parsePartialJson` already does best-effort; use the `invocation.input` it gives you.

## Codex's ExecCommand widget

`~/src/os/codex/codex-rs/protocol/src/protocol.rs:1500–1600`

For shell commands, Codex models three events:

- `ExecCommandBegin { call_id, command, cwd }` — UI: spinner + the command line.
- `ExecCommandOutputDelta { call_id, stream: 'stdout' | 'stderr', output: string }` — UI: append to a log pane.
- `ExecCommandEnd { call_id, exit_code, status }` — UI: exit-code badge, stop spinner.

The widget reserves space for the output pane immediately on `Begin`. Deltas append; they never insert above. `End` finalizes by adding the badge.

The transferable rule: **separate "this tool started" from "the tool finished"** as two events; the renderer can update in place without ever measuring or shifting.

## Tool approval flow

TanStack and Codex both pair an approval request with a separate response submission via a stable id.

TanStack: `~/src/os/tanstack-ai/packages/typescript/ai-client/src/chat-client.ts`

```ts
async addToolApprovalResponse({ id, approved }: { id: string; approved: boolean }) {
  this.processor.addToolApprovalResponse(id, approved);
  if (this.isLoading) {
    this.queuePostStreamAction(() => this.checkForContinuation());
  } else {
    await this.checkForContinuation();
  }
}
```

The agent loop pauses on approval-requested; a separate `addToolApprovalResponse` call resumes it. The continuation is its own request — the server reads the most recent message + the approval response and decides whether to run the tool (server) or just return the denial.

Codex: `~/src/os/codex/codex-rs/protocol/src/approvals.rs`

```rust
pub struct ExecApprovalRequestEvent {
    pub call_id: String,            // pairs with ExecApproval { id }
    pub turn_id: String,
    pub command: Vec<String>,
    pub reason: Option<String>,     // why approval is needed
    pub available_decisions: Vec<ReviewDecision>,  // [Approved, Denied, Abort]
}

pub enum ReviewDecision { Approved, Denied, TimedOut, Abort }
```

The `reason` field is critical UX: tells the user *why* this is being asked (e.g., "destructive: rm", "network: curl"). The available_decisions list is server-driven so the UI shows only legal choices.

## Custom rendering per tool

`~/src/os/tanstack-ai/examples/typescript/ts-react-chat/src/routes/index.tsx:220–340`

```tsx
{message.parts.map((part, index) => {
  // Approval UI for any tool that needs it
  if (part.type === 'tool-call' && part.state === 'approval-requested' && part.approval) {
    return <ApprovalDialog ... />;
  }
  // Custom card per tool
  if (part.type === 'tool-call' && part.name === 'recommendGuitar' && part.output) {
    return <GuitarRecommendation id={part.output?.id} />;
  }
  // Default: generic running/done badge
  return <ToolBadge state={part.state} name={part.name} />;
})}
```

Pattern: a small registry of per-tool renderers, with a generic fallback. Don't try to make every tool look the same.

## What our chat does

`web/src/app/(main)/chat/_components/messages.tsx`:
- `<ReadPageBadge>` — custom for `read_page`.
- `<SearchResultsBlock>` — custom for `search_wiki`.
- `<ToolCallBlock>` — generic fallback.

We don't currently render `input-streaming` differently from `input-available`. We don't surface tool errors with retry. We don't have approval flows.

## What to add

1. **Render `input-streaming` with partial input.** When `state === 'input-streaming'`, show the partial query/slug as it arrives ("Searching for 'KEYNO…'"). Same component, gated on state.
2. **Render `output-error` with a retry affordance.** Currently we collapse errors into the generic block; toast or inline retry button is better UX.
3. **Reserve min-height per tool block.** Avoid layout shifts when output arrives.
4. **Add a per-tool registry.** A small map `{ search_wiki: SearchResultsBlock, read_page: ReadPageBadge, ... }` with a generic fallback. Currently the `if/else` chain is fine for 5 tools but won't scale.
5. **Approval UI primitives.** Even though we don't gate any tool today, defining the `<ToolApprovalCard>` component (with `reason`, allowed decisions, callback) prepares us for destructive tools later.

## Top patterns to steal

| Pattern                                                   | From          |
| --------------------------------------------------------- | ------------- |
| Render partial input during input-streaming               | vercel/ai     |
| Reserve min-height + append-only output                   | codex         |
| `reason` field on approval requests (tells user *why*)    | codex         |
| `available_decisions` list driven by server               | codex         |
| Per-tool renderer registry with generic fallback          | TanStack      |
| `addToolApprovalResponse(id, approved)` separate from sendMessage | TanStack |
| Output-error state with retry hook                        | vercel/ai     |

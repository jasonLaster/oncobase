# Agent Loop Control

Multi-step tool-calling, when to stop, how to mutate the loop mid-flight.

## ToolLoopAgent — vercel/ai's agent abstraction

`~/src/os/vercel-ai/packages/ai/src/agent/tool-loop-agent.ts:138–184`
`~/src/os/vercel-ai/examples/next-agent/agent/weather-agent.ts:1–13`

```ts
import { ToolLoopAgent, stepCountIs, hasToolCall } from 'ai';

export const weatherAgent = new ToolLoopAgent({
  model: openai('gpt-4o'),
  instructions: 'You are a helpful assistant.',
  tools: { weather: weatherTool },
  stopWhen: [stepCountIs(10), hasToolCall('final_answer')],
  prepareStep: async ({ step, messages, usage }) => {
    if (usage.inputTokens > 100_000) {
      // approaching context window — force text-only on next step
      return { toolChoice: { type: 'none' } };
    }
    return {};
  },
});

// Server-side route handler:
export async function POST(req: Request) {
  const { messages } = await req.json();
  return createAgentUIStreamResponse({ agent: weatherAgent, uiMessages: messages });
}
```

Key callbacks (merged from `mergeCallbacks`):
- `experimental_onStart({ messages })` — first thing called, before the first model call
- `experimental_onStepStart({ step, messages })` — every iteration
- `onStepFinish({ step, finishReason, usage, toolCalls, toolResults })` — every iteration end
- `onFinish({ messages, finishReason, usage })` — terminal
- `onError({ error })` — any thrown error
- `onAbort({ steps })` — when abort signal fires

## stopWhen — when does the loop end?

`~/src/os/vercel-ai/packages/ai/src/generate-text/stop-condition.ts`

```ts
type StopCondition = (state: { steps, messages, usage }) => boolean | Promise<boolean>;

const stepCountIs = (n: number): StopCondition =>
  ({ steps }) => steps.length >= n;

const hasToolCall = (name: string): StopCondition =>
  ({ steps }) => steps.at(-1)?.toolCalls?.some(tc => tc.toolName === name) ?? false;

const isLoopFinished = (): StopCondition =>
  ({ steps }) => steps.at(-1)?.finishReason === 'stop';
```

Pass an array — any condition met stops the loop:

```ts
stopWhen: [stepCountIs(20), hasToolCall('final_answer'), customBudgetCondition]
```

The default is `stepCountIs(1)` — single-shot. Always set this explicitly for agent loops.

## prepareStep — mutate the next iteration

`prepareStep` runs **before each model call**. It can return a partial config that overrides the next step:

```ts
prepareStep: async ({ step, messages, usage, model }) => {
  // Switch to a cheaper model after step 5
  if (step.stepNumber > 5) return { model: openai('gpt-4o-mini') };
  // Or limit to a subset of tools
  if (step.stepNumber === 1) return { activeTools: ['search_wiki', 'list_pages'] };
  // Or inject a system message
  return { system: 'You must call read_page before answering.' };
}
```

Use cases:
- Token-budget escalation (cheaper model when getting expensive)
- Tool gating (force search before answering)
- Step-specific system prompts (different reasoning style at different stages)

## TanStack's continuation pattern

`~/src/os/tanstack-ai/packages/typescript/ai-client/src/chat-client.ts`

TanStack treats the agent loop as a sequence of separate request/response cycles:

```ts
async checkForContinuation() {
  // Look at the messages. Is there a user message at the end without an
  // assistant response? Or a tool-call with output but no following text?
  // If so, fire another sendMessage automatically.
  if (needsContinuation(this.processor.getMessages())) {
    await this.sendMessageInternal({ trigger: 'continue' });
  }
}
```

After `addToolApprovalResponse`, after `addToolResult`, after a stream ends with a tool-call-but-no-text, the client automatically fires another request. The server runs `streamText` again, sees the new state, decides what to do.

This is **simpler** than AI SDK's monolithic `ToolLoopAgent`: the loop is server-side per request, but the multi-turn continuation is client-side. Easier to reason about for resumption (each request is its own SSE stream).

## Codex's turn override

`~/src/os/codex/codex-rs/protocol/src/protocol.rs`

```rust
pub enum Op {
    UserTurn { items, cwd, approval_policy, sandbox_policy, model, ... },
    OverrideTurnContext {
        approval_policy: Option<AskForApproval>,
        sandbox_policy: Option<SandboxPolicy>,
        model: Option<String>,
        ...
    },
    ExecApproval { id, decision },
    Shutdown,
}
```

Mid-turn the user can call `OverrideTurnContext` to switch model, change approval policy, or relax/tighten sandbox. The server picks up the new context for the next step. Useful for "this is taking forever, switch to a faster model" or "this got dangerous, require approval for everything from here on".

## Codex's auto-compact

`~/src/os/codex/codex-rs/core/src/compact.rs:1–120`

```rust
pub const COMPACT_USER_MESSAGE_MAX_TOKENS: usize = 20_000;

pub async fn run_inline_auto_compact_task(
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    reason: CompactionReason, // Auto | UserRequested
) -> CodexResult<()> {
    // Calls the model with SUMMARIZATION_PROMPT + last_turn_output
    // Replaces history with [summary] + clear reference_context
}
```

When the input token count approaches the model's context window, the agent triggers an auto-compact. It calls the model with a summarization prompt, replaces the message history with the summary, and continues. The user sees a system message saying "history compacted".

## What our chat does

`web/src/app/api/chat/route.ts`:
- Uses `streamText` (not `ToolLoopAgent`).
- `stopWhen: stepCountIs(10)`.
- No `prepareStep`.
- No multi-turn continuation pattern (each user message → one streamText run).
- No auto-compact.

## What to add

1. **Use `ToolLoopAgent`** to encapsulate the loop. Lets us define the agent once, share between `/api/chat` and any future `/api/chat/regenerate` route.
2. **Add `prepareStep` for token-budget escalation.** When `usage.inputTokens > 80_000`, switch from the fast model to a smaller one or trim history. Today we just hit the wall.
3. **Add `hasToolCall('final_answer')` as an explicit stop**, paired with a `final_answer` tool that the model uses to terminate cleanly. Replaces "the loop ran out of steps" with "the model said it's done".
4. **Add `auto-compact`** when input tokens approach the limit. Either a server-side helper that summarizes the oldest N messages, or an explicit "Summarize this conversation" tool the model can invoke.
5. **Surface step state in the UI.** Today the streaming message just shows accumulating text. We should show a small "Step 2 of …" indicator during multi-step runs.

## Top patterns to steal

| Pattern                                                          | From         |
| ---------------------------------------------------------------- | ------------ |
| `ToolLoopAgent` as the unit of "an agent"                        | vercel/ai    |
| `stopWhen: [stepCountIs(n), hasToolCall(name), custom]`          | vercel/ai    |
| `prepareStep` for per-step config (model swap, tool gating)      | vercel/ai    |
| Mid-turn context override (model, approval policy, sandbox)      | codex        |
| Auto-compact when approaching context window                     | codex        |
| Continuation triggered by client (`checkForContinuation`)        | TanStack     |
| Explicit "final_answer" tool to terminate cleanly                | (recommended)|
| UI step indicator during multi-step runs                         | (recommended)|

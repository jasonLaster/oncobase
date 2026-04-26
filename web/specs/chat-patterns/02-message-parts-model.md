# Message + Parts Model

Every reference repo has converged on a discriminated-union "parts" model. Flat `content: string` is a dead end for agent UIs.

## Vercel/ai's UIMessage<META, DATA, TOOLS>

`~/src/os/vercel-ai/packages/ai/src/ui/ui-messages.ts:271–368`

```ts
type UIMessage<METADATA, DATA, TOOLS> = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: METADATA;
  parts: UIMessagePart<DATA, TOOLS>[];
};

type UIMessagePart<DATA, TOOLS> =
  | TextUIPart                     // { type: 'text'; text: string; state?: 'streaming' | 'done' }
  | ReasoningUIPart                // { type: 'reasoning'; text: string; state?: ... }
  | ToolUIPart<TOOLS>              // { type: 'tool-<name>'; state: ToolUIState; input?, output?, errorText?, ... }
  | DynamicToolUIPart              // { type: 'dynamic-tool'; toolName, ... }
  | SourceUrlUIPart                // { type: 'source-url'; url, title, ... }
  | SourceDocumentUIPart           // { type: 'source-document'; mediaType, title, ... }
  | FileUIPart                     // { type: 'file'; mediaType, url | data, ... }
  | ReasoningFileUIPart
  | DataUIPart<DATA>               // { type: `data-${string}`; data: DATA[key] }
  | StepStartUIPart;               // { type: 'step-start' }

type ToolUIState =
  | 'pending'              // dispatched but not yet receiving input deltas
  | 'input-streaming'      // partial JSON arriving
  | 'input-available'      // input fully parsed, awaiting execution
  | 'approval-requested'   // server paused for human approval
  | 'approval-responded'   // user decided
  | 'output-available'     // tool returned successfully
  | 'output-error'         // tool threw
  | 'output-denied';       // approval rejected
```

The TS types parameterize on TOOLS so each tool variant gets exact `input`/`output` types — no `as` casts at render time.

## TanStack's MessagePart

`~/src/os/tanstack-ai/packages/typescript/ai-client/src/types.ts:80–150`

```ts
type UIMessage<TTools> = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: MessagePart<TTools>[];
  createdAt?: Date;
};

type MessagePart<TTools> =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool-call'; id: string; name: ToolName; arguments: string;
      input?: InferToolInput<TTools[name]>;     // typed
      output?: InferToolOutput<TTools[name]>;   // typed
      state: 'awaiting-input' | 'input-streaming' | 'input-complete'
           | 'approval-requested' | 'completed' | 'failed';
      approval?: { id: string; needsApproval: boolean; approved?: boolean };
    }
  | { type: 'image'; source: { type: 'url' | 'base64'; value: string } }
  | { type: 'document'; ... };
```

Differences from AI SDK:
1. **Approval is its own field**, not a tool state. `tool-call` parts have `approval?: { id, needsApproval, approved }`. Cleaner pause/resume semantics.
2. **`name` is the discriminant on tool-call parts.** Switch on `part.name === 'searchWiki'` and TS narrows `part.input` / `part.output` to that tool's schema.
3. **Thinking is a top-level part type**, not nested under reasoning. Same effect, slightly different ergonomics.

## Codex's ItemStarted / ItemUpdated / ItemCompleted

`~/src/os/codex/sdk/typescript/src/items.ts`

```ts
type ThreadItem =
  | CommandExecutionItem    // tool call
  | FileChangeItem          // patch apply
  | AgentMessageItem        // text or reasoning chunk(s)
  | TodoListItem            // structured plan
  | ...;

type ThreadEvent =
  | ItemStartedEvent { item: ThreadItem }
  | ItemUpdatedEvent { item: ThreadItem }       // mutable state during streaming
  | ItemCompletedEvent { item: ThreadItem };    // final, immutable
```

The lifecycle events are **explicit**: started → updated (n times) → completed. The client renders by item state, not by sniffing whether some field has settled. This is more verbose than AI SDK's "the part type tells you the state" approach but it makes incomplete states impossible to misrepresent.

## What our chat currently does

`web/src/app/(main)/chat/_components/messages.tsx`

We use `UIMessage` from `ai`, with parts grouped by `kind` (`text`, `tools`, `other`) for compact display. The grouper function lives in `messages.tsx`. Tool parts use the AI SDK's state machine (`output-available`, etc.).

What we extract by hand that should live on the type:
- `extractSourcePages(parts)` walks tool outputs to build a sources block.
- `groupParts(parts)` collapses runs of consecutive text/tool parts.

## What to add

1. **Typed tool parts.** Right now `getToolInfo(part)` returns `{ toolName, state, input, output }` as `unknown`. Define a typed `ChatTools = { search_wiki: ..., read_page: ..., list_pages: ..., get_pages_by_tag: ..., list_tags: ... }` and use `UIMessage<ChatMetadata, ChatDataParts, ChatTools>` so the renderers get exact types per tool.

2. **Custom `data-*` parts for sources.** Instead of walking tool outputs to build a sources block, emit a `{ type: 'data-source-pages', data: { pages: [...] } }` part from `onFinish` on the server. The client just renders it. Reduces client logic and re-render cost.

3. **First-class `data-checkpoint` parts** if we ever add per-step checkpoints (like t3code's proposed plans).

## Top patterns to steal

| Pattern                                                         | From          | Why                                             |
| --------------------------------------------------------------- | ------------- | ----------------------------------------------- |
| `tool-${name}` per-tool typed parts                             | vercel/ai v6  | TS narrowing eliminates `as unknown as ...`     |
| `data-${name}` parts for app-defined structured data            | vercel/ai v6  | Reduces client-side derivation                  |
| Explicit `state` field on tool parts (input-streaming → output) | vercel/ai v6  | Drives renderer; no inference needed            |
| Approval as a separate object on tool parts (`approval.id`)     | TanStack      | Pair request/response without extra plumbing    |
| ItemStarted / ItemUpdated / ItemCompleted lifecycle events      | codex         | Always-correct rendering of in-flight items     |
| First-class thinking/reasoning parts                            | TanStack/AI   | Collapsible thought UI without content mangling |

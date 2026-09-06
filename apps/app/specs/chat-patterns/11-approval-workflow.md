# Approval Workflow

Pause-and-resume for tools that need a human in the loop. Most relevant for destructive shell commands, file writes, irreversible API calls. Less relevant for read-only research tools (which is most of what we have today) — but the architecture pays off the moment we add a single tool that touches state.

## TanStack's first-class approval

`~/src/os/tanstack-ai/packages/typescript/ai-client/src/chat-client.ts`

Tool definition opts in:

```ts
const deleteFileTool = toolDefinition({
  name: 'deleteFile',
  needsApproval: true,
  inputSchema: z.object({ path: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
});
```

The server, when the tool is called:

```ts
// Server-side tool handler
async function handleTool(invocation: ToolInvocation) {
  if (invocation.tool.needsApproval && !invocation.approval?.approved) {
    return emit({
      type: 'tool-call',
      state: 'approval-requested',
      approval: { id: nanoid(), needsApproval: true },
      ...invocation,
    });
    // PAUSE: server stops emitting until approval response received
  }
  // Execute and emit tool-result
}
```

The client UI, on rendering an approval-requested part:

```tsx
{part.state === 'approval-requested' && part.approval && (
  <ApprovalCard
    name={part.name}
    args={part.input}
    onApprove={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}
    onDeny={() => addToolApprovalResponse({ id: part.approval.id, approved: false })}
  />
)}
```

The continuation:

```ts
async addToolApprovalResponse({ id, approved }: { id: string; approved: boolean }) {
  this.processor.addToolApprovalResponse(id, approved);
  if (this.isLoading) {
    // queue; resume after current stream ends
    this.queuePostStreamAction(() => this.checkForContinuation());
  } else {
    await this.checkForContinuation();
  }
}
```

Three things to notice:
1. **Approval id is separate from tool call id.** Tool calls have `id`; the approval has `approval.id`. The pair survives separately.
2. **The client manages continuation.** After approval lands, the client fires another request to the server (`checkForContinuation`). The server reads the message history including the approval response and decides whether to execute or fall through.
3. **`needsApproval` is per-tool.** Per-call escalation (Codex `OverrideTurnContext`) is its own pattern; orthogonal.

## Codex's two-tier approval

`~/src/os/codex/codex-rs/protocol/src/approvals.rs`

```rust
pub struct ExecApprovalRequestEvent {
    pub call_id: String,
    pub approval_id: Option<String>,
    pub turn_id: String,
    pub command: Vec<String>,
    pub reason: Option<String>,             // why approval is needed
    pub available_decisions: Vec<ReviewDecision>,
}

pub struct ApplyPatchApprovalRequestEvent {
    pub call_id: String,
    pub turn_id: String,
    pub changes: HashMap<PathBuf, FileChange>, // {path: (add/delete/update)}
    pub reason: Option<String>,
}

pub enum AskForApproval {
    UnlessTrusted,  // auto-approve safe ops, ask for the rest
    Always,         // ask for everything (paranoid mode)
    Never,          // auto-approve everything (yolo mode)
}
```

Two key UX details:

1. **`reason: Option<String>`** — the server explains *why* approval is being asked. "destructive: rm", "network access required", "writes outside cwd". The UI shows this; the user makes an informed decision instead of clicking "Yes" reflexively.

2. **`available_decisions: Vec<ReviewDecision>`** — server-driven enumeration of what the user can choose. Some commands allow `[Approved, Denied, Abort]`; others just `[Approved, Denied]`. The UI shows only legal buttons.

The approval policy is per-turn (`AskForApproval` on `Op::UserTurn`). Mid-turn, the agent or user can call `OverrideTurnContext { approval_policy }` to escalate or relax. Pattern is: start in `UnlessTrusted`; if the agent runs into something dangerous and gets `Denied`, re-enter `Always` for the rest of the turn.

## t3code's approval contract

`~/src/os/t3code/packages/contracts/src/orchestration.ts:578–585`

```ts
ThreadApprovalRespondCommand = {
  type: "thread.approval.respond",
  requestId: ApprovalRequestId,
  decision: "accept" | "acceptForSession" | "decline" | "cancel",
};
```

`acceptForSession` is the killer feature: "yes, and don't ask me again for this kind of thing for the rest of the session." The server stores the consent on the thread; subsequent matching calls auto-approve.

This is the single highest-impact ergonomic win once we add destructive tools.

## When to gate which tools

For our research-assistant chat, today's tools (`search_wiki`, `read_page`, `list_pages`, `get_pages_by_tag`, `list_tags`) are read-only — no approval needed.

Future destructive tools that *would* need approval:
- `update_page(slug, content)` — writes back to the wiki
- `create_meeting_note(...)` — generates a new note
- `email_summary(to, subject, body)` — sends an email
- `schedule_event(when, what)` — creates a calendar entry

For each, the architecture is identical:
1. Tool defined with `needsApproval: true` (or equivalent gate).
2. Server emits an approval-requested part with `id`, `reason`, `args`.
3. Client renders an `<ApprovalCard>` with the args and `reason`, plus Approve / Deny buttons.
4. User decides; client fires `addToolApprovalResponse({ id, approved })`.
5. Server runs (or doesn't) the tool, emits the result.

## The UX of an approval card

```tsx
<ApprovalCard
  name="update_page"
  reason="This will overwrite the wiki page 'wiki/treatment/treatment-plan' with 1,247 characters of new content."
  args={{ slug: 'wiki/treatment/treatment-plan', content: '…' }}
  decisions={['approve', 'deny', 'approve-for-session']}
  onDecide={(decision) => addToolApprovalResponse({ id, decision })}
/>
```

UI:
```
┌─────────────────────────────────────────────────┐
│ ⚠ Approval needed                               │
│                                                 │
│ Tool: update_page                               │
│                                                 │
│ This will overwrite the wiki page              │
│ 'wiki/treatment/treatment-plan' with 1,247     │
│ characters of new content.                     │
│                                                 │
│ [show diff ▾]                                   │
│                                                 │
│ [Approve]  [Deny]  [Approve for session]        │
└─────────────────────────────────────────────────┘
```

For destructive operations, render a **diff preview** (for content edits) or a **dry-run output** (for shell commands). t3code does this via its DiffPanel for patches.

## What our chat does

We don't have approval today. The architecture should be ready for it.

## What to add

1. **Define the protocol now**, even before any tool needs it. Add `state: 'approval-requested'` to the parts model; emit it from any tool handler that opts in.

2. **`<ApprovalCard>` component** with props `{ name, reason, args, decisions, onDecide }`. Lives in `src/components/chat/approval-card.tsx`. Renders different content based on tool name (a default for unknown, custom for known).

3. **`addToolApprovalResponse` plumbing** in `chat-interface.tsx`. Wire to a Convex mutation `conversations.respondToApproval` that writes the decision to the conversation's pending-approvals row.

4. **Server-side gate** in the route. Before calling `tool.execute`, check `getPendingApproval(callId)`. If pending, emit the approval-requested part and return; the loop won't execute until a `checkForContinuation` request arrives with the response.

5. **`acceptForSession` storage.** Add a `consents: Record<string, ToolConsent>` field on the conversation. `ToolConsent = { tool: string; pattern?: string; until?: 'turn' | 'session' }`. Tool execution checks consents before emitting an approval request.

This pays for itself the first time we add `update_page` or `create_meeting_note`.

## Top patterns to steal

| Pattern                                              | From          |
| ---------------------------------------------------- | ------------- |
| `state: 'approval-requested'` on tool parts          | vercel/ai v6  |
| Separate `approval.id` from tool call id             | TanStack      |
| `reason` field telling user *why*                    | codex         |
| `available_decisions` list driven by server          | codex         |
| `acceptForSession` decision                          | t3code        |
| Per-turn approval policy + mid-turn override         | codex         |
| Diff preview for content edits                       | t3code        |
| Dry-run output for shell commands                    | codex         |
| Approve / Deny / Approve-for-session button row      | t3code        |
| `addToolApprovalResponse(id, approved)` API surface  | TanStack      |

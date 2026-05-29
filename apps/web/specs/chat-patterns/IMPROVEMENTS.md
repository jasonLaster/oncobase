# Improvements Plan

Concrete work items derived from [AUDIT.md](./AUDIT.md), ordered by impact and grouped into themed batches. Each batch is independently shippable.

The user's hard constraint: **preserve server-side navigation resilience** — the route handler must continue running and persisting state even when the client disconnects, so users can navigate away and back without losing the response.

The current architecture (Convex flusher writing a mirror) already gives us this *partially*. The headline change is to make the active SSE stream itself replayable end-to-end (Vercel's `createResumableStreamContext` pattern), so reconnecting clients see exact tokens instead of polling a 250ms-stale mirror.

## Batch A — server-side resilience (highest impact)

Owners: route handler + Convex schema. Net result: a user can submit, navigate to another page, come back, and pick up the live SSE stream from exactly where they were.

### A1. Decouple `streamText` abort from `req.signal`

The route currently uses the implicit request lifecycle as the abort signal. When the user navigates, the request closes, the signal fires, the model halts. That's wrong for navigation resilience.

Implementation:
- Pass an explicit `abortSignal: userStopSignal.signal` to `streamText`.
- `userStopSignal` is an `AbortController` constructed at request start.
- A throttled `onChunk` polls Convex `conversations.canceledAt` once per second; if set, calls `userStopSignal.abort()`.
- A new mutation `conversations.cancelStream(conversationId)` sets `canceledAt`. Called by the client's Stop button.

Files: `apps/web/src/app/api/chat/route.ts`, `convex/conversations.ts`, `convex/schema.ts` (add `canceledAt` column).

### A2. Wrap the response in `createResumableStreamContext` + `waitUntil`

The route returns the SSE stream now; we wrap it so the stream is buffered server-side keyed by `streamId`.

Implementation:
- Generate a `streamId` at request start (`createIdGenerator({ prefix: 'stream' })()`).
- Pass `consumeSseStream: async ({ stream }) => { const ctx = createResumableStreamContext({ waitUntil: after }); await ctx.createNewResumableStream(streamId, () => stream); await convex.mutation(api.conversations.setActiveStream, { conversationId, streamId }); }` to `toUIMessageStreamResponse`.
- On `onFinish`, clear `activeStreamId` (already done as part of finalize, just augment).

Files: `apps/web/src/app/api/chat/route.ts`, `convex/conversations.ts`, `convex/schema.ts` (add `activeStreamId` column).

### A3. Add GET reconnect endpoint

Same `/api/chat` route, GET handler. Reads `?id=conversationId`. If the conversation has an `activeStreamId`, replays the buffered stream. Otherwise 204.

Implementation:
```ts
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return new Response(null, { status: 400 });
  const conv = await convex.query(api.conversations.get, { id });
  if (!conv?.activeStreamId) return new Response(null, { status: 204 });
  const ctx = createResumableStreamContext({ waitUntil: after });
  const stream = await ctx.resumeExistingStream(conv.activeStreamId);
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

Files: `apps/web/src/app/api/chat/route.ts`.

### A4. Client-side `useChat({ resume: true })`

In `chat-interface.tsx`, pass `resume: true` to useChat so on every mount it tries to reconnect. The hook calls `transport.reconnectToStream()` which hits the GET endpoint. If 204, it falls through; the Convex mirror remains the catch-up surface.

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

**Result of Batch A**: server runs to completion regardless of disconnect; reconnecting clients see the live SSE stream replay. Navigation resilience formalized end-to-end.

## Batch B — typed parts model + server-emitted data parts

### B1. Define typed `ChatUIMessage`

```ts
// apps/web/src/lib/chat/types.ts
import type { UIMessage } from 'ai';

export type ChatMetadata = {
  conversationId?: string;
  createdAt?: number;
};

export type ChatDataParts = {
  'source-pages': { pages: { slug: string; title: string }[] };
  'status': { phase: 'searching' | 'reading' | 'thinking' | 'composing'; detail?: string };
};

export type ChatTools = typeof chatTools; // imported from route's tool definitions

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts, ChatTools>;
```

Files: `apps/web/src/lib/chat/types.ts` (new), `apps/web/src/app/api/chat/route.ts` (export `chatTools`), `apps/web/src/app/(main)/chat/_components/messages.tsx` (use `ChatUIMessage` everywhere instead of `UIMessage`).

### B2. Server emits `data-source-pages`

Stop computing sources client-side. In `onFinish` (or `onStepFinish`), the server walks the steps and emits a single `data-source-pages` part via the UI message stream writer.

Implementation:
- Use `createUIMessageStream` API or `messageMetadata` callback on `toUIMessageStreamResponse` to emit the part.
- Drop `extractSourcePages(parts)` from `messages.tsx`.

Files: `apps/web/src/app/api/chat/route.ts`, `apps/web/src/app/(main)/chat/_components/messages.tsx`.

### B3. Server emits `data-status` for tool progress

When a tool starts, emit `{ type: 'data-status', data: { phase: 'searching', detail: 'KEYNOTE-522' } }`. The streaming-tail renderer reads it for the "thinking" indicator above the message.

Files: `apps/web/src/app/api/chat/route.ts`, `apps/web/src/app/(main)/chat/_components/messages.tsx`.

## Batch C — rendering polish

### C1. Streamdown on by default

Flip the `NEXT_PUBLIC_CHAT_STREAMDOWN` flag to `1` in the default code path; remove the `react-markdown` fallback for the chat. Keep `react-markdown` for the wiki (separate consumer).

Files: `apps/web/src/components/chat/streaming-markdown.tsx` (remove flag check), `apps/web/specs/chat-performance-qa.md` (mark Phase 5 fully landed).

### C2. Custom `<CodeBlock>` with copy + language

Override Streamdown's `code` component:

```tsx
<Streamdown components={{
  code: ({ className, children }) => {
    const lang = className?.replace('language-', '');
    if (!lang) return <code className={className}>{children}</code>;
    return <CodeBlock language={lang} code={String(children)} showLineNumbers />;
  },
}}>
```

Files: `apps/web/src/components/chat/streaming-markdown.tsx`, `apps/web/src/components/chat/code-block.tsx` (new, or use ai-elements).

### C3. Memoize `groupParts` per assistant message

Wrap the `groupParts(parts)` call inside `<AssistantMessage>` in a `useMemo` keyed on `parts`. Today it runs on every render of the streaming tail.

Files: `apps/web/src/app/(main)/chat/_components/messages.tsx`.

### C4. Streaming caret

Pass `caret="block"` to `Streamdown` so a small block cursor follows the streaming text. Disable under `prefers-reduced-motion`.

Files: `apps/web/src/components/chat/streaming-markdown.tsx`.

## Batch D — message ergonomics

### D1. `<Message>` compound component

```tsx
<Message role="assistant" data-slot="message">
  <MessageHeader>{/* avatar, timestamp, model */}</MessageHeader>
  <MessageContent>{/* parts */}</MessageContent>
  <MessageFooter>
    <CopyButton text={text} />
    <RegenerateButton />
    <ForkButton />
  </MessageFooter>
</Message>
```

Wrap `<UserMessageRow>` and `<AssistantMessage>` in this compound. Footer actions appear on hover; user messages have Edit; assistant messages have Copy/Regenerate/Fork.

Files: `apps/web/src/app/(main)/chat/_components/message.tsx` (new), `apps/web/src/app/(main)/chat/_components/messages.tsx` (refactor).

### D2. Copy button

Copies the assistant message's text to clipboard. Toast confirmation via Sonner.

Files: same as D1.

### D3. Regenerate button

Calls `useChat.regenerate({ messageId })`. The route needs to accept a `trigger: 'regenerate-message'` body and recompute from the conversation history.

Files: `apps/web/src/app/(main)/chat/_components/message.tsx`, `apps/web/src/app/api/chat/route.ts`.

### D4. Fork button (placeholder for now)

Toast: "Fork coming soon" — or implement the fork mutation that copies messages up to (and including) the selected message into a new conversation.

Files: same as D3.

## Batch E — composer ergonomics

### E1. Slash command palette

A `<CommandDialog>` keyed to `Cmd+K`. Initial commands:
- `/clear` — confirm + clear conversation (or archive + new).
- `/export` — download as markdown.
- `/fork` — duplicate at current point.
- Suggested questions.

Files: `apps/web/src/app/(main)/chat/_components/command-palette.tsx` (new), `chat-interface.tsx` (mount).

### E2. Persist composer drafts

`sessionStorage` keyed by `chat:draft:${conversationId ?? 'new'}`. Save on input change, debounced 300ms. Restore on mount.

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

### E3. Up-arrow to edit last user message

When the composer is empty AND focused AND the user presses Up, fill the textarea with the last user message and slice subsequent. Esc cancels.

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

### E4. `Cmd+/` to focus composer

Global keydown listener on the chat page. Caveat: sidebar shortcuts use Cmd+B; cmdk uses Cmd+K. `Cmd+/` is free.

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

### E5. `Esc` to abort active stream

Global keydown when chat status is `streaming`.

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

## Batch F — error UX

### F1. Sonner toaster at the chat root

`<Toaster richColors position="top-right" />` in the chat layout. Used for transient errors (network blips), copy confirmations, save notices.

Files: `apps/web/src/app/(main)/chat/layout.tsx`, root layout if not already mounted.

### F2. Inline retry on error blocks

The error block in the message list gets a "Retry" button that fires `regenerate({ messageId })` against the last user message.

Files: `apps/web/src/app/(main)/chat/_components/messages.tsx` (or message.tsx after D1).

### F3. Typed error response

Server returns `{ error: { code: 'auth' | 'credits' | 'context-limit' | 'server-error' | 'validation', message: string } }`. Client renders different UX per code.

Files: `apps/web/src/app/api/chat/route.ts`, `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

## Batch G — agent loop control

### G1. `prepareStep` for token budget

When `usage.inputTokens > 80_000`, prepareStep returns `{ model: smallerModel }` and/or trims oldest non-system messages. (We'd need to define `smallerModel` in `lib/ai.ts`.)

Files: `apps/web/src/app/api/chat/route.ts`, `apps/web/src/lib/ai.ts`.

### G2. UI step indicator

While a multi-step run is in progress, show a small "Step 2 of 10" indicator in the streaming tail. The server emits step starts via `data-status` parts (Batch B).

Files: `apps/web/src/app/(main)/chat/_components/messages.tsx`.

## Batch H — accessibility polish

### H1. axe-core in CI

Add `@axe-core/playwright` and a `chat-a11y.spec.ts` Playwright test that injects axe and asserts no violations.

Files: `apps/web/e2e/chat-a11y.spec.ts` (new), `apps/web/package.json` (devDep).

### H2. Cmd+/ handler (covered in E4)

### H3. Live region for tool status changes

Each tool block, when its `state` transitions to `output-available` or `output-error`, fires a one-shot `aria-live="polite"` announcement ("Search complete: 12 results").

Files: `apps/web/src/app/(main)/chat/_components/messages.tsx`.

## Batch I — multi-tab niceties

### I1. Bidirectional sync

When `status === 'ready'` AND Convex's `messages.length` is **less than** local, replace local. Covers cross-tab edits.

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

### I2. "Active in another tab" indicator

If the active SSE stream is being driven by a different tab (we can detect: `useChat.status === 'ready'` AND Convex `streamingText` is non-empty AND `activeStreamId` is set), show a small badge in the header. Click to take over (calls reconnect).

Files: `apps/web/src/app/(main)/chat/_components/chat-interface.tsx`.

## Batch J — approval protocol skeleton (build before needed)

### J1. Define types

Add `state: 'approval-requested' | 'approval-responded'` to the parts model. Define `<ApprovalCard>` component. Wire `addToolApprovalResponse` plumbing.

Files: `apps/web/src/lib/chat/types.ts`, `apps/web/src/app/(main)/chat/_components/approval-card.tsx` (new), Convex mutation.

### J2. Server-side gate

In tool definitions that opt in (`needsApproval: true`), emit the approval-requested part instead of executing. Wait for the response.

Files: `apps/web/src/app/api/chat/route.ts`.

(No tool today needs this; ship the protocol so the next destructive tool is plug-and-play.)

## Sequencing recommendation

If we ship in batches:

1. **A** (resilience) — biggest win, server-side. **Must preserve current behavior.** Do this first.
2. **B** (typed parts) — cleans up the renderer surface. Unblocks C/D/G.
3. **C** (rendering polish) — Streamdown default + memo + caret.
4. **D** (message ergonomics) — Copy / Regenerate / Edit.
5. **F** (error UX) — Sonner + retry.
6. **E** (composer) — slash commands, drafts, keyboard.
7. **G** (agent loop) — prepareStep + step indicator.
8. **H** (a11y) — axe-core, live regions.
9. **I** (multi-tab) — bidirectional sync, indicator.
10. **J** (approval) — protocol skeleton.

Time estimate: A is half a day, B/C are each half a day, D-J are each a day or less. Full lift ≈ 5–6 days of focused work. PR-able in batches.

## Acceptance per batch

Each batch lands clean if:
- `bun run typecheck && bun run lint && bun run test:unit` all pass.
- `bun run build` succeeds.
- `bun playwright test e2e/chat.spec.ts e2e/chat-perf.spec.ts` passes against a local dev server (with env vars).
- Manual: send → navigate away → navigate back → assistant message is correct.
- Manual: stop button still aborts the model (Batch A doesn't break Stop).
- Manual: cross-tab observation still works (Batch A doesn't break the mirror).

# Streaming Architecture

How tokens get from the model to the DOM, and what gets buffered/smoothed/throttled along the way.

## The four layers

```
model.tokens()
   │
   ▼ (provider stream, raw cadence)
streamText() ── experimental_transform: smoothStream({ delayInMs, chunking }) ── server cadence smoother
   │
   ▼ (UI message stream protocol)
toUIMessageStreamResponse() ── SSE wire (text/event-stream, x-vercel-ai-ui-message-stream: v1)
   │
   ▼ (transport)
DefaultChatTransport.processResponseStream() ── ReadableStream<UIMessageChunk>
   │
   ▼ (state machine)
processUIMessageStream() ── reducer that mutates Chat.messages
   │
   ▼ (subscriptions)
useChat({ experimental_throttle }) ── DOM-update throttler
   │
   ▼
React commit
```

Every layer has its own cadence knob. They don't substitute for each other:

- **`smoothStream`** smooths the **server output** so the client receives words at a controlled rate (good for slow networks where bursts are visible).
- **`experimental_throttle`** batches **DOM commits** so React doesn't render at 60Hz when tokens arrive at 200Hz.

## smoothStream — server-side cadence

`~/src/os/vercel-ai/packages/ai/src/generate-text/smooth-stream.ts:29–162`

```ts
function smoothStream<TOOLS>({ delayInMs, chunking }: {
  delayInMs?: number | null;
  chunking?: 'word' | 'line' | RegExp | ChunkDetector | Intl.Segmenter;
} = {}): (options: { tools: TOOLS }) => TransformStream<TextStreamPart, TextStreamPart> {
  const detectChunk = chunkDetectorFor(chunking ?? 'word');
  return () => new TransformStream({
    transform: async (chunk, controller) => {
      if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta') {
        controller.enqueue(chunk); // pass-through
        return;
      }
      buffer += chunk.text;
      while ((match = detectChunk(buffer))) {
        controller.enqueue({ ...chunk, text: match.text });
        buffer = match.rest;
        await delay(delayInMs);
      }
    },
    flush: (controller) => buffer && controller.enqueue({ ...lastChunk, text: buffer }),
  });
}
```

Chunking strategies:
- `'word'` — splits on word boundary; default; good for English/European text.
- `'line'` — releases on newline; good for code blocks where you want full lines.
- `RegExp` — custom splitter (e.g., `/\s+/`).
- `Intl.Segmenter` — grapheme-aware; required for **CJK languages** where word boundaries are language-defined.
- `ChunkDetector` — `(buffer) => { text, rest } | null`; full control.

Tool calls and step-finish events pass through **unmodified** — only text/reasoning deltas are smoothed.

Wire it in the route:

```ts
// apps/web/src/app/api/chat/route.ts
const result = streamText({
  model,
  messages,
  tools,
  experimental_transform: smoothStream({ delayInMs: 25, chunking: 'word' }),
  // ...
});
return result.toUIMessageStreamResponse({ generateMessageId, originalMessages });
```

## experimental_throttle — client-side DOM batching

`~/src/os/vercel-ai/packages/react/src/chat.react.ts:68–79`

```ts
'~registerMessagesCallback': (onChange, throttleWaitMs) => {
  const throttled = throttleWaitMs ? throttle(onChange, throttleWaitMs) : onChange;
  return this.subscribeToMessages(throttled);
},
```

`throttle` is `throttleit`. It coalesces calls within the window: every change schedules a flush; intermediate state is dropped, only the latest snapshot is committed.

Effect: a 50ms throttle caps DOM commits at ~20Hz. A typical model emits 30–80 tokens/s; without throttling that's 30–80 React commits/s, each re-rendering the entire message tree. With throttling: 20 commits/s, each capturing whatever batch of tokens accumulated.

Recommendation:
- **`experimental_throttle: 50`** is the sweet spot for typical desktops. Smooth enough to feel live, cheap enough to keep `<PriorMessages>` from being a hot loop.
- Pair with `smoothStream({ delayInMs: 25, chunking: 'word' })` so even at 50ms throttle, the user sees ~2 words per commit (not a burst of 10).

## Transports — DefaultChatTransport vs custom

`~/src/os/vercel-ai/packages/ai/src/ui/http-chat-transport.ts:145–186`

Two methods you can override:

```ts
prepareSendMessagesRequest({ id, messages, body, trigger, messageId }) {
  // Shape the POST body. Common patterns:
  // - send only the last message (server has the rest in DB)
  // - on regenerate: { id, messageId, trigger } only
  // - inject conversationId, model, settings
  return {
    body: { ...(body ?? {}), messages: messages.slice(-1), conversationId, trigger, messageId },
  };
}

prepareReconnectToStreamRequest({ id, body, headers }) {
  // For resumable streams; how to fetch the buffered tail.
  return { headers };
}
```

The vercel/ai-chatbot example (`~/src/os/vercel-ai/examples/next/app/chat/[chatId]/chat.tsx:22–51`) sends only the last message on submit and `{ trigger: 'regenerate-message', messageId }` on regenerate. **This minimizes uplink bytes** — the server pulls the rest from the DB.

## TanStack's chunked SSE protocol

`~/src/os/tanstack-ai/packages/typescript/ai-client/src/sse-parser.ts:49–81`

```ts
export async function* parseSSEResponse(response: Response): AsyncGenerator<StreamChunk> {
  const reader = response.body?.getReader();
  for await (const line of readStreamLines(reader)) {
    const data = line.startsWith('data: ') ? line.slice(6) : line;
    try {
      yield JSON.parse(data) as StreamChunk;
    } catch { /* warn, skip */ }
  }
}
```

Chunks are typed JSON objects, not OpenAI-shaped deltas:
- `TEXT_MESSAGE_CONTENT { delta, content }`
- `TOOL_CALL_START { toolCall: { name, arguments: '' } }`
- `TOOL_CALL_ARGS`, `TOOL_CALL_END`
- `TOOL_RESULT { id, result }`
- `THINKING_START`, `THINKING_CONTENT`, `THINKING_END`
- `RUN_FINISHED { finishReason }`

Compared to AI SDK's UIMessageChunk: TanStack's protocol is **adapter-agnostic from the start**. Each chunk type is its own discriminator. AI SDK is more expressive (text-start / text-end events, reasoning, sources, files, custom data parts) but harder to extend with provider-specific signals.

## Codex Op/Event queue model

`~/src/os/codex/codex-rs/protocol/src/protocol.rs:1800–1900`

Codex uses a **bidirectional submission queue (SQ) / event queue (EQ)** model:

- Client → server: `Op::UserTurn`, `Op::ExecApproval`, `Op::OverrideTurnContext`, `Op::Shutdown`.
- Server → client: `EventMsg::TurnStarted`, `AgentMessageDelta`, `ExecCommandBegin`, `ExecCommandOutputDelta`, `TurnComplete`, `TokenCount`, `TurnAborted`, …

Every event carries `turn_id`. Approval events also carry `call_id`. The server can emit `Lagged { skipped: usize }` if its bounded channel overflows — the client knows it missed events instead of silently buffering forever.

Lessons that transfer to a web chat:

1. **Strict event types**, not "just-shape-it" JSON. Each variant is its own data class. The client switches on type, never sniffs fields.
2. **Backpressure is a first-class signal.** If the client is slow, the server drops with notification, not silently.
3. **Op + Event are separate.** Don't conflate "user submits" with "stream tells client what's happening". They're different queues.

## Recommendation for our stack

Keep the existing layers:
- Server: `streamText` with `smoothStream({ delayInMs: 25, chunking: 'word' })`.
- Server: Convex flusher running as a side effect in `onChunk` / `onFinish` (the navigation-resilience layer).
- Server: return `result.toUIMessageStreamResponse({ generateMessageId, originalMessages, consumeSseStream })`.
- Client: `useChat({ transport: new DefaultChatTransport({ api, prepareSendMessagesRequest }), experimental_throttle: 50 })`.
- Client: when reconnecting (e.g., after navigation), `useChat({ resume: true })` calls `transport.reconnectToStream()` to fetch the buffered tail.

Add (currently missing):
- **`createResumableStreamContext` + `consumeSseStream`** so the SSE stream itself is replayable from the server side. See [09-persistence-resumption.md](./09-persistence-resumption.md).
- **`prepareSendMessagesRequest`** that sends only the trailing message (we currently send the full array).
- **`Intl.Segmenter` for CJK** in `smoothStream` (currently using `'word'`; English-only).

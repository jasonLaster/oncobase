import { expect, test } from "bun:test";
import { makeFunctionReference } from "convex/server";
import { createConvexFlusher } from "./flusher";
import type { ChatConvexApi } from "./types";

const conversations = {
  updateStreaming: makeFunctionReference<"mutation">("conversations:updateStreaming"),
  saveMessages: makeFunctionReference<"mutation">("conversations:saveMessages"),
  clearStreaming: makeFunctionReference<"mutation">("conversations:clearStreaming"),
} as ChatConvexApi["conversations"];

function setup() {
  const writes: Array<{ ref: unknown; args: Record<string, unknown> }> = [];
  let notifyFlush!: () => void;
  const flushed = new Promise<void>((resolve) => { notifyFlush = resolve; });
  const flusher = createConvexFlusher({
    convex: {
      mutation: async (ref, args) => {
        writes.push({ ref, args: structuredClone(args) });
        if (ref === conversations.updateStreaming) notifyFlush();
      },
    },
    conversations,
    conversationId: "conversation",
    runId: "run",
    siteSlug: "site",
    intervalMs: 1,
  });
  return { flusher, writes, flushed };
}

test("flushes summaries before answer text for resumed chat views", async () => {
  const { flusher, writes, flushed } = setup();
  flusher.pushReasoning("Checking ");
  flusher.pushReasoning("the sources.");
  await flushed;
  expect(writes[0].args).toEqual({
    conversationId: "conversation", runId: "run", siteSlug: "site",
    text: "", parts: [{ type: "reasoning", text: "Checking the sources." }],
  });
  expect(flusher.getCurrentText()).toBe("");
  await flusher.finalizeAbort();
});

test("keeps summaries, tools, and answer text in order through persistence", async () => {
  const { flusher, writes } = setup();
  flusher.pushReasoning("Find a source.");
  flusher.pushToolCall({ type: "tool-read", toolCallId: "tool", state: "calling" });
  flusher.updateToolResult("tool", { title: "Source" });
  flusher.pushReasoning("Compare ");
  flusher.pushReasoning("the evidence.");
  flusher.pushText("The answer.");
  const parts = flusher.getCurrentParts();
  expect(parts).toEqual([
    { type: "reasoning", text: "Find a source." },
    { type: "tool-read", toolCallId: "tool", state: "output-available", output: { title: "Source" } },
    { type: "reasoning", text: "Compare the evidence." },
    { type: "text", text: "The answer." },
  ]);
  await flusher.finalize([{
    role: "assistant", content: flusher.getCurrentText(),
    parts: parts as unknown as string, createdAt: 1, messageId: "message",
  }]);
  expect(writes.map(({ ref }) => ref)).toEqual([
    conversations.saveMessages, conversations.clearStreaming,
  ]);
  expect(writes[0].args.messages).toEqual([{
    role: "assistant", content: "The answer.", parts, createdAt: 1, messageId: "message",
  }]);
});

test("cancelling during a summary clears the stream without saving a partial answer", async () => {
  const { flusher, writes } = setup();
  flusher.pushReasoning("Still checking.");
  await flusher.finalizeAbort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(writes.map(({ ref }) => ref)).toEqual([conversations.clearStreaming]);
});

// Deterministic stand-in for the chat model, enabled with WIKI_CHAT_FAKE_MODEL=1
// (local stack and e2e only; never set in a deployment). It replaces ONLY the
// provider call: auth, persistence, streaming, Stop and queueing all run for real.
//
// Reply: "fake-reply: <last user text>". A prompt containing "[slow]" is followed
// by a long tail (about six seconds) so tests can Stop or queue mid-stream.

type PromptPart = { type?: string; text?: string };
type PromptMessage = { role: string; content: string | PromptPart[] };

const SLOW_TAIL_WORDS = 60;
const SLOW_WORD_DELAY_MS = 100;

export const isFakeChatModelEnabled = () => process.env.WIKI_CHAT_FAKE_MODEL === "1";

function lastUserText(prompt: PromptMessage[]) {
  const message = [...prompt].reverse().find((entry) => entry.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" ? part.text ?? "" : "")).join("");
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export function createFakeChatModel() {
  return {
    specificationVersion: "v3" as const,
    provider: "fake",
    modelId: "fake-chat-model",
    supportedUrls: {},
    async doGenerate(): Promise<never> {
      throw new Error("The fake chat model only supports streaming.");
    },
    async doStream(options: { prompt: PromptMessage[]; abortSignal?: AbortSignal }) {
      const prompt = lastUserText(options.prompt);
      const signal = options.abortSignal;
      const words = `fake-reply: ${prompt}`.split(/\s+/);
      if (prompt.includes("[slow]")) {
        for (let index = 1; index <= SLOW_TAIL_WORDS; index += 1) words.push(String(index));
      }
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({ type: "text-start", id: "t1" });
          for (const [index, word] of words.entries()) {
            if (signal?.aborted) { controller.close(); return; }
            controller.enqueue({ type: "text-delta", id: "t1", delta: index === 0 ? word : ` ${word}` });
            await sleep(index > 8 ? SLOW_WORD_DELAY_MS : 5, signal);
          }
          if (!signal?.aborted) {
            controller.enqueue({ type: "text-end", id: "t1" });
            controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
          }
          controller.close();
        },
      });
      return { stream };
    },
  };
}

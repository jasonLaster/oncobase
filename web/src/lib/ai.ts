import { createOpenAI } from "@ai-sdk/openai";

const openrouter = createOpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
});

/** The fast, cheap text model — see scripts/eval-chat.ts for the leaderboard */
export function fastTextModel() {
  return openrouter.chat("openai/gpt-5.4-mini");
}

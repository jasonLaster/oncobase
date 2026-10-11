import { createGateway } from "ai";
import { EducationCorpusSchema } from "@oncobase/education/chat";
import { chatTextModel } from "@oncobase/wiki-content/chat-route";
import { createEducationChatHandler } from "../../../app/server/education-chat";
import { canonicalJson, learningScenarios, readRecording, sha256 } from "./gateway-recording";

export async function createGatewayReplay() {
  const text = await Bun.file("out/chat-index.json").text();
  const corpus = EducationCorpusSchema.parse(JSON.parse(text));
  const model = chatTextModel({ VERCEL_ENV: "production" });
  const recordings = learningScenarios.map(scenario => ({ scenario, recording: readRecording(scenario.id) }));
  for (const { scenario, recording } of recordings) {
    if (recording.contentCommit !== corpus.contentCommit || recording.corpusSha256 !== sha256(text) || recording.model !== model) throw Error(`Stale Gateway fixture ${scenario.id}: build the pinned content and run chat:record to refresh.`);
  }
  const receipts = new Map<string, { scenario: string; turn: number; calls: number; expectedCalls: number; sse?: string; error?: string }>();
  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/__chat-e2e/health") return Response.json({ mode: "gateway-replay", contentCommit: corpus.contentCommit });
    if (pathname.startsWith("/__chat-e2e/receipts/")) return Response.json(receipts.get(pathname.split("/").at(-1)!) ?? null);
    if (pathname !== "/api/education/chat") return undefined;
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    const body = await request.clone().json();
    const questions = body.messages.filter((message: { role: string }) => message.role === "user").map((message: { parts: Array<{ type: string; text?: string }> }) => message.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n"));
    const match = recordings.find(({ scenario }) => canonicalJson(scenario.questions.slice(0, questions.length)) === canonicalJson(questions) && body.currentSlug === ("currentSlug" in scenario ? scenario.currentSlug : undefined));
    const turn = match?.recording.turns[questions.length - 1];
    if (!match || !turn) return Response.json({ error: "No recorded public learning scenario matches this request" }, { status: 422 });
    const id = crypto.randomUUID();
    const receipt = { scenario: match.scenario.id, turn: questions.length, calls: 0, expectedCalls: turn.exchanges.length, sse: undefined as string | undefined, error: undefined as string | undefined };
    receipts.set(id, receipt);
    const gateway = createGateway({ apiKey: "offline-e2e-playback", fetch: Object.assign(async (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      const exchange = turn.exchanges[receipt.calls++];
      const actual = { model: new Headers(init?.headers).get("ai-language-model-id"), body: JSON.parse(String(init?.body)) };
      if (String(url) !== "https://ai-gateway.vercel.sh/v3/ai/language-model" || !exchange || canonicalJson(actual) !== canonicalJson(exchange.request)) {
        receipt.error = `Gateway request ${receipt.calls} differs from the recording; review the prompt, retrieval, tool results or model and re-record intentionally.`;
        return Response.json({ error: { type: "invalid_request_error", message: receipt.error } }, { status: 400 });
      }
      // No network fallback. Feed genuine captured provider SSE through the SDK.
      return new Response(exchange.response.body, { status: exchange.response.status, headers: exchange.response.headers });
    }, { preconnect: () => {} }) });
    const handler = createEducationChatHandler({ getCorpus: async () => corpus, model: gateway(model) });
    const response = await handler(request);
    void response.clone().text().then(sse => { receipt.sse = sse; }).catch(() => { receipt.error ??= "The handler stream did not complete"; });
    response.headers.set("x-oncoguide-e2e-id", id);
    return response;
  };
}

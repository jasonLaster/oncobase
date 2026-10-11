import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { createGateway } from "ai";
import { EducationCorpusSchema } from "@oncobase/education/chat";
import { chatTextModel } from "@oncobase/wiki-content/chat-route";
import { createEducationChatHandler } from "../../app/server/education-chat";
import { fixtureDirectory, learningScenarios, responseSnapshot, sha256, type GatewayExchange, type GatewayRecording } from "../e2e/support/gateway-recording";

if (!process.env.AI_GATEWAY_API_KEY) throw Error("Recording requires AI_GATEWAY_API_KEY on the server. Replay tests need no credentials.");
const corpusText = await Bun.file("out/chat-index.json").text();
const corpus = EducationCorpusSchema.parse(JSON.parse(corpusText));
const model = chatTextModel({ VERCEL_ENV: "production" });
const sdk = { ai: (await Bun.file(require.resolve("ai/package.json")).json()).version, gateway: (await Bun.file(require.resolve("@ai-sdk/gateway/package.json")).json()).version };
const recordings: GatewayRecording[] = [];
const selected = process.argv.slice(2);
if (selected.some(id => !learningScenarios.some(scenario => scenario.id === id))) throw Error("Pass only scenario IDs from learningScenarios, or no arguments to record all");
for (const scenario of learningScenarios.filter(scenario => !selected.length || selected.includes(scenario.id))) {
  const recording: GatewayRecording = { version: 1, scenario: scenario.id, recordedAt: new Date().toISOString(), model, contentCommit: corpus.contentCommit, corpusSha256: sha256(corpusText), sdk, turns: [] };
  const history: Array<{ role: "user" | "assistant"; parts: Array<{ type: "text"; text: string }> }> = [];
  for (const question of scenario.questions) {
    const exchanges: GatewayExchange[] = [];
    const pending: Promise<void>[] = [];
    const gateway = createGateway({ fetch: Object.assign(async (url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
      if (String(url) !== "https://ai-gateway.vercel.sh/v3/ai/language-model") throw Error("Unexpected Gateway request");
      // Do not persist request headers: they contain credentials and tracing IDs.
      const request = { model: new Headers(init?.headers).get("ai-language-model-id")!, body: JSON.parse(String(init?.body)) };
      const response = await fetch(url, init);
      const exchange: GatewayExchange = { request, response: { status: response.status, headers: { "content-type": response.headers.get("content-type") || "text/event-stream" }, body: "" } };
      exchanges.push(exchange);
      pending.push(response.clone().text().then(body => { exchange.response.body = body; }));
      return response;
    }, { preconnect: () => {} }) });
    const handler = createEducationChatHandler({ getCorpus: async () => corpus, model: gateway(model) });
    history.push({ role: "user", parts: [{ type: "text", text: question }] });
    const response = await handler(new Request("http://localhost/api/education/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, contentCommit: corpus.contentCommit, currentSlug: "currentSlug" in scenario ? scenario.currentSlug : undefined }) }));
    const body = await response.text();
    await Promise.all(pending);
    const snapshot = responseSnapshot(body, exchanges);
    if (!response.ok || snapshot.errors.length || !snapshot.explanations.join("").trim() || !exchanges.length || exchanges.some(exchange => exchange.response.status !== 200)) throw Error(`Recording failed for ${scenario.id}: ${question}`);
    history.push({ role: "assistant", parts: [{ type: "text", text: snapshot.explanations.join("\n") }] });
    recording.turns.push({ question, exchanges });
    console.info(`${scenario.id}, turn ${recording.turns.length}: ${exchanges.length} Gateway calls, ${snapshot.citations.length} citations`);
  }
  recordings.push(recording);
}
// Replace fixtures only after every real scenario completes successfully.
await mkdir(fixtureDirectory, { recursive: true });
for (const recording of recordings) {
  const destination = path.join(fixtureDirectory, `${recording.scenario}.json`);
  const serialized = `${JSON.stringify(recording, null, 2)}\n`;
  if ([process.env.AI_GATEWAY_API_KEY, process.env.VERCEL_OIDC_TOKEN].some(secret => secret && serialized.includes(secret))) throw Error("Refusing to persist a recording containing server credentials");
  await Bun.write(`${destination}.tmp`, serialized);
  await rename(`${destination}.tmp`, destination);
}
console.info(`Recorded ${recordings.length} public learning scenarios via ${model}. Review and update response snapshots with test:e2e:chat --update-snapshots.`);

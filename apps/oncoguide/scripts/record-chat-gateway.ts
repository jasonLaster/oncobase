import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { createGateway } from "ai";
import { EducationCorpusSchema } from "@oncobase/education/chat";
import { EducationVisualCatalogSchema } from "@oncobase/education/visuals";
import { chatTextModel } from "@oncobase/wiki-content/chat-route";
import { createEducationChatHandler, gatewayDecide } from "../../app/server/education-chat";
import { fixtureDirectory, learningScenarios, responseSnapshot, sha256, type DecisionExchange, type GatewayExchange, type GatewayRecording } from "../e2e/support/gateway-recording";

if (!process.env.AI_GATEWAY_API_KEY) throw Error("Recording requires AI_GATEWAY_API_KEY on the server. Replay tests need no credentials.");
const corpusText = await Bun.file("out/chat-index.json").text();
const corpus = EducationCorpusSchema.parse(JSON.parse(corpusText));
const catalog = EducationVisualCatalogSchema.parse(await Bun.file("out/visual-catalog.json").json());
const model = chatTextModel({ VERCEL_ENV: "production" });
const sdk = { ai: (await Bun.file(require.resolve("ai/package.json")).json()).version, gateway: (await Bun.file(require.resolve("@ai-sdk/gateway/package.json")).json()).version };
const recordings: GatewayRecording[] = [];
const selected = process.argv.slice(2);
if (selected.some(id => !learningScenarios.some(scenario => scenario.id === id))) throw Error("Pass only scenario IDs from learningScenarios, or no arguments to record all");
for (const scenario of learningScenarios.filter(scenario => !selected.length || selected.includes(scenario.id))) {
  const recording: GatewayRecording = { version: 1, scenario: scenario.id, recordedAt: new Date().toISOString(), model, contentCommit: corpus.contentCommit, corpusSha256: sha256(corpusText), sdk, turns: [] };
  const history: Array<{ role: "user" | "assistant"; parts: Array<{ type: "text"; text: string }> }> = [];
  let lastVisual: { id: string; kind: string; pageTitle: string } | undefined;
  const turns = scenario.questions.length + ("thenTapVisual" in scenario ? 1 : 0);
  for (let turn = 0; turn < turns; turn++) {
    // A tap sends the id of the visual the previous answer showed, worded as the page words it.
    const tapped = turn >= scenario.questions.length ? lastVisual : undefined;
    if (turn >= scenario.questions.length && !tapped) throw Error(`The first answer of ${scenario.id} showed no visual to tap. Record it again.`);
    const question = tapped ? `Walk me through this ${tapped.kind === "cartoon" ? "picture" : tapped.kind} from “${tapped.pageTitle}”.` : scenario.questions[turn]!;
    const exchanges: GatewayExchange[] = [];
    const pending: Promise<void>[] = [];
    const decisions: DecisionExchange[] = [];
    // The real decision models answer, and what they said is kept for replay.
    const decide: typeof gatewayDecide = async (input, questions, signal) => {
      const decision = await gatewayDecide(input, questions, signal);
      decisions.push({ request: { input, questions }, response: { model: decision.model, answers: [...decision.answers.values()].map(answer => ({ ...answer, name: answer.name! })) } });
      return decision;
    };
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
    const handler = createEducationChatHandler({ getCorpus: async () => corpus, getVisuals: async () => catalog, decide, model: gateway(model) });
    history.push({ role: "user", parts: [{ type: "text", text: question }] });

    const response = await handler(new Request("http://localhost/api/education/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history, contentCommit: corpus.contentCommit, currentSlug: "currentSlug" in scenario ? scenario.currentSlug : undefined, ...(tapped ? { focusVisual: tapped.id, focusMode: "explain" } : {}) }) }));
    const body = await response.text();
    await Promise.all(pending);
    const snapshot = responseSnapshot(body, exchanges);
    lastVisual = (snapshot.visuals as Array<{ id: string; kind: string; pageTitle: string }>)[0];
    if (!response.ok || snapshot.errors.length || !snapshot.explanations.join("").trim() || !exchanges.length || exchanges.some(exchange => exchange.response.status !== 200)) throw Error(`Recording failed for ${scenario.id}: ${question}`);
    history.push({ role: "assistant", parts: [{ type: "text", text: snapshot.explanations.join("\n") }] });
    if (!tapped && !decisions.length) throw Error(`No decision model answered for ${scenario.id}: ${question}`);
    recording.turns.push({ question, exchanges, decisions });
    console.info(`${scenario.id}, turn ${recording.turns.length}: ${decisions.map(decision => `decided by ${decision.response.model}, `).join("")}${exchanges.length} Gateway calls, ${snapshot.citations.length} citations`);
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

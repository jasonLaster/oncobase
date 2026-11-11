import { createUIMessageStream, createUIMessageStreamResponse, embed, stepCountIs, ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";
import { EducationCorpusSchema, EDUCATION_TUTOR_PROMPT, EDUCATION_VISUALS_PROMPT, namesALesson, placedVisualsPrompt, searchEducation, sectionReference, type EducationCorpus, type EducationReference, type EducationSection } from "@oncobase/education/chat";
import { contentQuestions, createDecider, DECISION_MODELS, decisionInput, planContent, type ContentPlan, type Decide } from "@oncobase/education/decisions";
import { blendSections, nearestSections, parseSemanticIndex, type SemanticIndex } from "@oncobase/education/semantic";
import { followUps, lessonCard } from "@oncobase/education/tutor";
import { EducationVisualCatalogSchema, rankVisuals, visualCaption, visualForModel, type EducationVisual, type EducationVisualCatalog } from "@oncobase/education/visuals";
import { chatTextModel } from "@oncobase/wiki-content/chat-route";
import { runAfterResponse } from "./background";

const RequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.object({ type: z.string(), text: z.string().max(8000).optional() })).max(50),
  })).min(1).max(30),
  currentSlug: z.string().max(300).optional(),
  // A visual the reader tapped, by its catalog id, and what they want done with it.
  focusVisual: z.string().max(500).optional(),
  focusMode: z.enum(["explain", "quiz", "check"]).optional(),
  contentCommit: z.string().max(80).optional(),
});
let cachedCorpus: { value: EducationCorpus; expires: number } | undefined;
let loadingCorpus: Promise<EducationCorpus> | undefined;

async function loadCorpus() {
  if (cachedCorpus && cachedCorpus.expires > Date.now()) return cachedCorpus.value;
  loadingCorpus ??= (async () => {
    // Server configuration only. Readers cannot choose a URL or supply evidence.
    const response = await fetch(process.env.ONCOGUIDE_CHAT_INDEX_URL || "https://oncoguide.cc/chat-index.json", { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) throw Error("The education library is unavailable");
    const text = await limitedText(response.body, 10 * 1024 * 1024);
    const value = EducationCorpusSchema.parse(JSON.parse(text));
    cachedCorpus = { value, expires: Date.now() + 60_000 };
    return value;
  })().finally(() => { loadingCorpus = undefined; });
  return loadingCorpus;
}

let cachedVisuals: { value: EducationVisualCatalog | null; expires: number } | undefined;
let loadingVisuals: Promise<EducationVisualCatalog | null> | undefined;

/** The catalog is optional. Without it the tutor still answers, and the reader
 * gets the cartoons that lesson search finds. */
async function loadVisuals() {
  if (cachedVisuals && cachedVisuals.expires > Date.now()) return cachedVisuals.value;
  loadingVisuals ??= (async () => {
    let value: EducationVisualCatalog | null = null;
    try {
      const response = await fetch(process.env.ONCOGUIDE_VISUAL_CATALOG_URL || "https://oncoguide.cc/visual-catalog.json", { signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (response.ok) value = EducationVisualCatalogSchema.parse(JSON.parse(await limitedText(response.body, 5 * 1024 * 1024)));
    } catch { /* Answer without chosen visuals. */ }
    cachedVisuals = { value, expires: Date.now() + 60_000 };
    return value;
  })().finally(() => { loadingVisuals = undefined; });
  return loadingVisuals;
}

let cachedSemantic: { value: SemanticIndex | null; expires: number } | undefined;
let loadingSemantic: Promise<SemanticIndex | null> | undefined;

/** Search by meaning is optional too: the content build writes vectors only
 * when it is given credentials, and keyword search works without them. */
async function loadSemantic() {
  if (cachedSemantic && cachedSemantic.expires > Date.now()) return cachedSemantic.value;
  loadingSemantic ??= (async () => {
    let value: SemanticIndex | null = null;
    try {
      const response = await fetch(process.env.ONCOGUIDE_SEARCH_VECTORS_URL || "https://oncoguide.cc/search-vectors.json", { signal: AbortSignal.timeout(10_000), redirect: "error" });
      if (response.ok) value = parseSemanticIndex(JSON.parse(await limitedText(response.body, 8 * 1024 * 1024)));
    } catch { /* Search by keyword. */ }
    cachedSemantic = { value, expires: Date.now() + (value ? 600_000 : 60_000) };
    return value;
  })().finally(() => { loadingSemantic = undefined; });
  return loadingSemantic;
}
/** A slow embedding must not hold up the answer, so it gets a little over a second. */
async function embedQuestion(index: SemanticIndex, text: string) {
  const { embedding } = await embed({ model: index.model, value: text.slice(0, 1000), providerOptions: { openai: { dimensions: index.dimensions } }, maxRetries: 0, abortSignal: AbortSignal.timeout(1200) });
  return embedding;
}

async function limitedText(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) throw Error("Empty body");
  const reader = body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw Error("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

/** Decides what to show through the AI Gateway: Jev first, GPT-6 Luna if Jev cannot answer.
 * `ONCOGUIDE_DECISION_MODELS` replaces the list; set it empty to let the tutor choose visuals itself. */
const decisionModels = () => (process.env.ONCOGUIDE_DECISION_MODELS ?? DECISION_MODELS.join(",")).split(",").map(model => model.trim()).filter(Boolean);
export const gatewayDecide: Decide = (input, questions, signal) => createDecider({
  models: decisionModels(),
  token: async () => process.env.AI_GATEWAY_API_KEY || await import("@vercel/oidc").then(({ getVercelOidcToken }) => getVercelOidcToken()).catch(() => undefined),
})(input, questions, signal);

const MAX_VISUALS = 2;
const MAX_CANDIDATES = 12;
const MAX_STEPS = 5;

const FALLBACK_COVERAGE = 0.7;

export function createEducationChatHandler({
  getCorpus = loadCorpus, getVisuals = getCorpus === loadCorpus ? loadVisuals : async () => null,
  getSemantic = getCorpus === loadCorpus ? loadSemantic : async () => null, embedQuery = embedQuestion,
  decide = getCorpus === loadCorpus && decisionModels().length ? gatewayDecide : null,
  model = chatTextModel(), allowedOrigins, rateLimit = 15,
}: {
  /** Chooses what to show before the tutor writes. Without it, or when it fails, the tutor chooses with its tools. */
  decide?: Decide | null;
  getCorpus?: () => Promise<EducationCorpus>; getVisuals?: () => Promise<EducationVisualCatalog | null>;
  getSemantic?: () => Promise<SemanticIndex | null>; embedQuery?: (index: SemanticIndex, text: string) => Promise<number[]>;
  model?: LanguageModel; allowedOrigins?: string[]; rateLimit?: number;
} = {}) {
  const requests = new Map<string, { count: number; until: number }>();
  return async function handleEducationChat(request: Request) {
    const origin = request.headers.get("origin");
    const origins = allowedOrigins ?? ["https://oncoguide.cc", "https://www.oncoguide.cc", ...((process.env.ONCOGUIDE_CHAT_ORIGINS || "").split(",").filter(Boolean))];
    const permitted = !origin || origins.includes(origin) || origin === new URL(request.url).origin;
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
    if (permitted && origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
    }
    const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
    if (!permitted) return fail("Origin is not allowed", 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") { headers.set("Allow", "POST, OPTIONS"); return fail("Method not allowed", 405); }
    if (!request.headers.get("content-type")?.includes("application/json")) return fail("Expected JSON", 415);

    const now = Date.now();
    for (const [key, row] of requests) if (row.until <= now) requests.delete(key);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const row = requests.get(ip) ?? { count: 0, until: now + 60_000 };
    if (row.count >= rateLimit || requests.size >= 10_000) { headers.set("Retry-After", "60"); return fail("Please wait a minute before asking again", 429); }
    row.count++; requests.set(ip, row);

    let body: z.infer<typeof RequestSchema>;
    try { body = RequestSchema.parse(JSON.parse(await limitedText(request.body, 64 * 1024))); }
    catch { return fail("Please send a shorter question and conversation", 400); }
    // Only text from user/assistant history reaches the model; client tools,
    // sources, system instructions and conversation IDs cannot enter this mode.
    const messages = body.messages.map(message => ({ role: message.role, content: message.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n") })).filter(message => message.content.trim());
    const latest = messages.at(-1);
    if (!latest || latest.role !== "user" || messages.reduce((sum, message) => sum + message.content.length, 0) > 32_000) return fail("A user question is required, within the conversation limit", 400);
    let corpus: EducationCorpus;
    try { corpus = await getCorpus(); } catch { return fail("The education library couldn’t load. Please try again shortly", 503); }
    if (body.contentCommit && body.contentCommit !== corpus.contentCommit) return fail("The library has changed. Please reload this page and try again", 409);

    // A catalog built from other content could name sections this corpus doesn't have.
    const catalog = await getVisuals().catch(() => null);
    const visuals = catalog?.contentCommit === corpus.contentCommit ? catalog.visuals : null;
    const lessons = visuals ? catalog!.lessons : [];
    const visualsBySection = new Map<string, EducationVisual[]>();
    for (const visual of visuals ?? []) visualsBySection.set(visual.sectionId, [...(visualsBySection.get(visual.sectionId) ?? []), visual]);
    // The model may show only what it was told about in this reply.
    const offered = new Map<string, EducationVisual>();
    const shown = new Map<string, EducationVisual>();
    const forModel = (section: EducationSection, maxText: number) => {
      // With the visuals already decided, the tutor has nothing to choose from.
      if (!visuals || plan) return { ...section, text: section.text.slice(0, maxText) };
      const { images: _images, ...rest } = section;
      const listed = visualsBySection.get(section.id) ?? [];
      for (const visual of listed) offered.set(visual.id, visual);
      return { ...rest, text: section.text.slice(0, maxText), visuals: listed.map(visualForModel) };
    };

    // Keywords always. Meaning as well when the build supplied vectors and the question embeds in time.
    const semantic = await getSemantic().then(index => index?.contentCommit === corpus.contentCommit ? index : null).catch(() => null);
    const sectionById = semantic ? new Map(corpus.sections.map(section => [section.id, section])) : undefined;
    const search = async (question: string, limit = 6) => {
      const keyword = searchEducation(corpus.sections, question, semantic ? 12 : limit, { lessons });
      if (!semantic) return keyword;
      const vector = await embedQuery(semantic, question).catch(() => null);
      if (!vector) return keyword.slice(0, limit);
      const meaning = nearestSections(semantic, vector, 24).map(id => sectionById!.get(id)).filter((section): section is EducationSection => Boolean(section));
      return blendSections(keyword, meaning, namesALesson(lessons, question), limit);
    };

    const current = corpus.sections.find(section => section.slug === body.currentSlug);
    const previousQuestion = [...messages.slice(0, -1)].reverse().find(message => message.role === "user")?.content ?? "";
    const needsContext = /\b(it|that|this|they|those|more|simpler|example|diagram|cartoon)\b/i.test(latest.content);
    const context = current && /\b(this|lesson|page|topic)\b/i.test(latest.content) ? current.pageTitle : previousQuestion;
    const query = `${latest.content} ${needsContext ? context : ""}`;
    // A visual the reader tapped leads the context, so the answer is about that exact picture.
    const focus = body.focusVisual ? visuals?.find(visual => visual.id === body.focusVisual) : undefined;
    const focusSection = focus && corpus.sections.find(section => section.id === focus.sectionId);
    const found = await search(focus ? `${focus.pageTitle} ${focus.heading}` : query);
    // Before the tutor writes, a decision model scores what search proposed and fixed rules pick what shows.
    // A tapped visual is already the reader's choice.
    let plan: ContentPlan | null = null;
    if (decide && visuals && !focus) {
      const candidates = [...new Map([...rankVisuals(visuals, query, { limit: 8, lessons }).map(row => row.visual), ...found.slice(0, 3).flatMap(section => visualsBySection.get(section.id) ?? [])].map(visual => [visual.id, visual])).values()].slice(0, MAX_CANDIDATES);
      plan = await decide(decisionInput(latest.content, needsContext ? context : undefined), contentQuestions(candidates, found), request.signal)
        .then(decision => planContent(candidates, found, decision)).catch(() => null);
    }
    const relevant = focusSection ? [focusSection, ...found.filter(section => section.id !== focusSection.id)].slice(0, 6) : found;
    const pageIndex = [...new Map(corpus.sections.map(section => [section.slug, `${section.pageTitle}: ${section.slug}`])).values()].join("\n");
    const initialContext = relevant.map(section => forModel(section, 3000));
    const references = new Map<string, EducationReference>((plan?.cards ?? relevant.slice(0, 3)).map(section => [section.id, sectionReference(section)]));
    for (const visual of plan?.visuals ?? []) { offered.set(visual.id, visual); shown.set(visual.id, visual); }
    if (focus) { offered.set(focus.id, focus); if (body.focusMode !== "check") shown.set(focus.id, focus); }
    const marker = (visual: EducationVisual) => `[[visual:${[...shown.keys()].indexOf(visual.id) + 1}]]`;
    const about = focus ? JSON.stringify({ ...visualForModel(focus), lesson: focus.pageTitle, section: focus.sectionId }) : "";
    const focusInstructions = !focus ? "" : body.focusMode === "quiz"
      ? `\nThe reader asked to be quizzed on this visual, which is showing as ${marker(focus)}: ${about}. Put ${marker(focus)} on its own line, then ask exactly one short question about what it shows${focus.question ? `, using the lesson's own question: "${focus.question}"` : ""}. Do not answer it or hint at the answer. Stop after the question.`
      : body.focusMode === "check"
        ? `\nThe reader is answering your question about this visual: ${about}.${focus.answer ? ` The lesson's own answer is: "${focus.answer}".` : ""} Say what they got right, gently correct what they missed, in under 120 words, then offer one next step. Do not call show_visual for it.`
        : `\nThe reader tapped this visual and wants it explained. It is showing as ${marker(focus)}: ${about}. Put ${marker(focus)} on its own line first, then walk through what it shows, using only its description, the words on it and its section's text. Do not call show_visual for it.`;
    const stream = createUIMessageStream({
      onError: () => "The reply couldn’t finish. Please try again.",
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        const sendResources = () => {
          const selected = [...references.values()].slice(-6);
          if (visuals) {
            const isCartoon = (visual: EducationVisual) => visual.kind === "cartoon";
            // Until the tutor chooses, show the cartoon that best matches the question, if one matches well.
            const [match] = shown.size || focus || plan ? [] : rankVisuals(visuals, query, { limit: 1, kind: "cartoon", lessons });
            const showing = shown.size ? [...shown.values()].map(visual => ({ ...visual, marker: marker(visual) })) : match && match.coverage >= FALLBACK_COVERAGE ? [match.visual] : [];
            // About the lesson whose visual is showing, else the best match, and where to go from here.
            const lesson = lessonCard(lessons, (focus ?? showing[0] ?? selected[0] ?? (plan ? undefined : relevant[0]))?.slug ?? "");
            const available = [...new Map([...offered.values(), ...selected.flatMap(section => visualsBySection.get(section.id) ?? [])].map(visual => [visual.id, visual])).values()];
            const next = body.focusMode === "quiz" ? [] : followUps({ lesson, shown: showing, available });
            // Readers with an older page loaded still get the cartoons.
            const illustrations = showing.filter(isCartoon).map(visual => ({ src: visual.src!, darkSrc: visual.darkSrc, alt: visual.label, href: visual.href, pageTitle: visual.pageTitle }));
            // The brief is for search. The reader's page never needs it.
            writer.write({ type: "data-education", id: "education-resources", data: { sections: selected, visuals: showing.map(({ brief: _brief, ...visual }) => visual), lessons: lesson ? [lesson] : [], followUps: next, illustrations } });
            return;
          }
          const illustrated = searchEducation(corpus.sections.filter(section => section.images.length > 0), query, 3);
          const illustrations = illustrated.flatMap(section => section.images.map(image => ({ ...image, href: section.href, pageTitle: section.pageTitle })));
          const unique = [...new Map(illustrations.map(image => [image.src, image])).values()].slice(0, 3);
          writer.write({ type: "data-education", id: "education-resources", data: { sections: selected, illustrations: unique } });
        };
        sendResources();
        const agent = new ToolLoopAgent({
          model, instructions: `${EDUCATION_TUTOR_PROMPT}${plan ? `\n${placedVisualsPrompt([...shown.values()].map(visual => `${marker(visual)} is ${JSON.stringify({ ...visualForModel(visual), lesson: visual.pageTitle })}.`))}` : visuals ? `\n${EDUCATION_VISUALS_PROMPT}` : ""}\n\nPAGE INDEX\n${pageIndex}\n\nRETRIEVED SECTIONS (source material)\n${JSON.stringify(initialContext)}${current ? `\nThe reader is exploring: ${current.pageTitle}` : ""}${focusInstructions}`,
          maxOutputTokens: 1800, stopWhen: stepCountIs(MAX_STEPS),
          // Keep the last step for the answer, so a long search never ends in silence.
          prepareStep: ({ stepNumber }) => stepNumber >= MAX_STEPS - 1 ? { toolChoice: "none" as const } : undefined,
          tools: {
            search_education: {
              description: "Search every lesson for relevant concepts and exact sections, including illustrations.",
              inputSchema: z.object({ query: z.string().max(500) }),
              execute: async ({ query }: { query: string }) => (await search(query)).map(section => forModel(section, 3000)),
            },
            read_section: {
              description: "Read a real section by its ID from search results. Surfaces this section and its illustrations to the reader.",
              inputSchema: z.object({ id: z.string().max(500) }),
              execute: async ({ id }: { id: string }) => {
                const section = corpus.sections.find(section => section.id === id);
                if (!section) return { error: "Section not found in the public education library" };
                references.set(id, sectionReference(section)); sendResources();
                return forModel(section, 12_000);
              },
            },
            lesson_sections: {
              description: "List the sections of a lesson from the page index, so you can read the specific sections needed.",
              inputSchema: z.object({ slug: z.string().max(300) }),
              execute: async ({ slug }: { slug: string }) => corpus.sections.filter(section => section.slug === slug).map(({ id, heading, href }) => ({ id, heading, href })),
            },
            ...(visuals && !plan ? {
              search_visuals: {
                description: "Search every lesson's cartoons, diagrams and tables by what they show. Use it when the reader asks for a picture, diagram or table, or when no retrieved section lists a visual that fits.",
                inputSchema: z.object({ query: z.string().max(300), kind: z.enum(["cartoon", "diagram", "table"]).optional() }),
                execute: async ({ query, kind }: { query: string; kind?: EducationVisual["kind"] }) => rankVisuals(visuals, query, { limit: 6, kind, lessons }).map(({ visual }) => {
                  offered.set(visual.id, visual);
                  return { ...visualForModel(visual), lesson: visual.pageTitle, section: visual.sectionId };
                }),
              },
              show_visual: {
                description: "Show the reader one real cartoon, diagram or table in your answer, by an id listed under a retrieved section's visuals or returned by search_visuals.",
                inputSchema: z.object({ visual_id: z.string().max(500) }),
                execute: async ({ visual_id }: { visual_id: string }) => {
                  const visual = offered.get(visual_id);
                  if (!visual) return { error: "No such visual. Use an id exactly as listed under a retrieved section's visuals or returned by search_visuals." };
                  if (!shown.has(visual.id) && shown.size >= MAX_VISUALS) return { error: "Two visuals are already showing. Explain with those." };
                  shown.set(visual.id, visual); sendResources();
                  return { showing: visual.kind, marker: marker(visual), caption: visualCaption(visual), section: visual.href };
                },
              },
            } : {}),
          },
        });
        const result = await agent.stream({ messages, abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(60_000)]) });
        writer.merge(result.toUIMessageStream({ sendStart: false, sendReasoning: false, onError: () => "The reply couldn’t finish. Please try again." }));
      },
    });
    return createUIMessageStreamResponse({ stream, headers,
      consumeSseStream: ({ stream }) => runAfterResponse(stream.pipeTo(new WritableStream()), "education chat stream"),
    });
  };
}

export const handleEducationChat = createEducationChatHandler();

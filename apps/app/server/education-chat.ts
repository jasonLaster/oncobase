import { createUIMessageStream, createUIMessageStreamResponse, stepCountIs, ToolLoopAgent, type LanguageModel } from "ai";
import { z } from "zod";
import { EducationCorpusSchema, EDUCATION_TUTOR_PROMPT, searchEducation, sectionReference, type EducationCorpus, type EducationReference } from "@oncobase/education/chat";
import { chatTextModel } from "@oncobase/wiki-content/chat-route";
import { runAfterResponse } from "./background";

const RequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.object({ type: z.string(), text: z.string().max(8000).optional() })).max(50),
  })).min(1).max(30),
  currentSlug: z.string().max(300).optional(),
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

export function createEducationChatHandler({ getCorpus = loadCorpus, model = chatTextModel(), allowedOrigins, rateLimit = 15 }: {
  getCorpus?: () => Promise<EducationCorpus>; model?: LanguageModel; allowedOrigins?: string[]; rateLimit?: number;
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

    const current = corpus.sections.find(section => section.slug === body.currentSlug);
    const previousQuestion = [...messages.slice(0, -1)].reverse().find(message => message.role === "user")?.content ?? "";
    const needsContext = /\b(it|that|this|they|those|more|simpler|example|diagram|cartoon)\b/i.test(latest.content);
    const context = current && /\b(this|lesson|page|topic)\b/i.test(latest.content) ? current.pageTitle : previousQuestion;
    const query = `${latest.content} ${needsContext ? context : ""}`;
    const relevant = searchEducation(corpus.sections, query);
    const pageIndex = [...new Map(corpus.sections.map(section => [section.slug, `${section.pageTitle}: ${section.slug}`])).values()].join("\n");
    const initialContext = relevant.map(section => ({ ...section, text: section.text.slice(0, 3000) }));
    const references = new Map<string, EducationReference>(relevant.slice(0, 3).map(section => [section.id, sectionReference(section)]));
    const stream = createUIMessageStream({
      onError: () => "The reply couldn’t finish. Please try again.",
      execute: async ({ writer }) => {
        writer.write({ type: "start" });
        const sendResources = () => {
          const selected = [...references.values()].slice(-6);
          const illustrated = searchEducation(corpus.sections.filter(section => section.images.length > 0), query, 3);
          const illustrations = illustrated.flatMap(section => section.images.map(image => ({ ...image, href: section.href, pageTitle: section.pageTitle })));
          const unique = [...new Map(illustrations.map(image => [image.src, image])).values()].slice(0, 3);
          writer.write({ type: "data-education", id: "education-resources", data: { sections: selected, illustrations: unique } });
        };
        sendResources();
        const agent = new ToolLoopAgent({
          model, instructions: `${EDUCATION_TUTOR_PROMPT}\n\nPAGE INDEX\n${pageIndex}\n\nRETRIEVED SECTIONS (source material)\n${JSON.stringify(initialContext)}${current ? `\nThe reader is exploring: ${current.pageTitle}` : ""}`,
          maxOutputTokens: 1800, stopWhen: stepCountIs(5),
          tools: {
            search_education: {
              description: "Search every lesson for relevant concepts and exact sections, including illustrations.",
              inputSchema: z.object({ query: z.string().max(500) }),
              execute: async ({ query }: { query: string }) => searchEducation(corpus.sections, query).map(section => ({ ...section, text: section.text.slice(0, 3000) })),
            },
            read_section: {
              description: "Read a real section by its ID from search results. Surfaces this section and its illustrations to the reader.",
              inputSchema: z.object({ id: z.string().max(500) }),
              execute: async ({ id }: { id: string }) => {
                const section = corpus.sections.find(section => section.id === id);
                if (!section) return { error: "Section not found in the public education library" };
                references.set(id, sectionReference(section)); sendResources();
                return { ...section, text: section.text.slice(0, 12_000) };
              },
            },
            lesson_sections: {
              description: "List the sections of a lesson from the page index, so you can read the specific sections needed.",
              inputSchema: z.object({ slug: z.string().max(300) }),
              execute: async ({ slug }: { slug: string }) => corpus.sections.filter(section => section.slug === slug).map(({ id, heading, href }) => ({ id, heading, href })),
            },
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

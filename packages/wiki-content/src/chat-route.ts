import { z } from "zod";

export const PRODUCTION_CHAT_MODEL = "openai/gpt-5.6-luna";
export const NON_PRODUCTION_CHAT_MODEL = "deepseek/deepseek-v4-flash";

export type ChatTextModel =
  | typeof PRODUCTION_CHAT_MODEL
  | typeof NON_PRODUCTION_CHAT_MODEL;

type ChatModelEnvironment = Record<string, string | undefined>;

export function chatTextModel(
  env: ChatModelEnvironment = process.env,
): ChatTextModel {
  return env.VERCEL_ENV === "production"
    ? PRODUCTION_CHAT_MODEL
    : NON_PRODUCTION_CHAT_MODEL;
}

/**
 * Wiki chat has two audiences. People using the production site get the
 * strong model. Everything else (previews, local stacks, CI, and automated
 * browsers on production) gets a cheap open-weight model. OncoGuide's tutor
 * keeps `chatTextModel`: its replay fixtures are pinned to that model.
 */
export type WikiChatAudience = "person" | "automation";
export const WIKI_CHAT_MODELS: Record<WikiChatAudience, string> = {
  person: "anthropic/claude-sonnet-5.5",
  automation: "deepseek/deepseek-v4.1-flash",
};
/** Tried in order when every provider for the primary model fails. */
export const WIKI_CHAT_FALLBACK_MODELS: Record<WikiChatAudience, string[]> = {
  person: ["openai/gpt-6.2-astra", "openai/gpt-5.6-luna"],
  automation: ["openai/gpt-5.6-luna"],
};
/**
 * Sent by the chat client when the browser is automated (navigator.webdriver)
 * and by scripted callers. It can only choose the cheaper model, so it needs
 * no authentication.
 */
export const WIKI_CHAT_AUTOMATION_HEADER = "x-oncobase-chat-automation";

export function wikiChatAudience(
  env: ChatModelEnvironment = process.env,
  headers?: { get(name: string): string | null },
): WikiChatAudience {
  if (env.VERCEL_ENV !== "production") return "automation";
  return headers?.get(WIKI_CHAT_AUTOMATION_HEADER) === "1" ? "automation" : "person";
}

/** `WIKI_CHAT_MODEL` / `WIKI_CHAT_AUTOMATION_MODEL` override a tier without a code change. */
export function wikiChatModel(env: ChatModelEnvironment = process.env, audience = wikiChatAudience(env)): string {
  const override = audience === "person" ? env.WIKI_CHAT_MODEL : env.WIKI_CHAT_AUTOMATION_MODEL;
  return override?.trim() || WIKI_CHAT_MODELS[audience];
}

export function wikiChatFallbackModels(
  env: ChatModelEnvironment = process.env,
  audience = wikiChatAudience(env),
  primary = wikiChatModel(env, audience),
): string[] {
  const configured = audience === "person" ? env.WIKI_CHAT_FALLBACK_MODELS : env.WIKI_CHAT_AUTOMATION_FALLBACK_MODELS;
  const models = configured === undefined
    ? WIKI_CHAT_FALLBACK_MODELS[audience]
    : configured.split(",").map((model) => model.trim()).filter(Boolean);
  return models.filter((model) => model !== primary);
}

/**
 * AI Gateway routing for wiki chat. Pages carry patient records, so every
 * attempt (fallbacks included) may only reach providers with zero data
 * retention that do not train on prompts.
 */
export function wikiChatGatewayOptions(fallbacks: string[]) {
  return {
    models: fallbacks,
    zeroDataRetention: true,
    disallowPromptTraining: true,
  };
}

/** Pages the prompt embeds as PATIENT DIAGNOSIS, newest location first. */
export const WIKI_CHAT_DIAGNOSIS_SLUGS = ["wiki/care/diagnosis", "wiki/diagnostics/diagnosis"];

/**
 * Canonical wiki chat system prompt used by both the Next chat route and
 * the Vite standalone chat route. Hosts that need a different prompt should
 * pass their own via `loadSystemPrompt` rather than diverge a copy of this
 * constant; the two apps previously kept drifting versions and the chat
 * citation-shape contracts only stay stable when both sides share one source.
 */
export const WIKI_CHAT_SYSTEM_PROMPT_BASE = `You are a research assistant for an Oncobase knowledge base. You help answer questions about the site's documents, care context, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using compact inline markdown links: [short label](/slug#section-anchor)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Prefer the most specific page anchor when the source has an obvious heading or section; otherwise cite the page.
- Example: "The treatment plan uses [KEYNOTE-522](/wiki/treatment/treatment-plan#keynote-522), which includes..."
- Cite specific source pages when referencing research: [Sahin 2026](/sources/research-articles/sahin-2026-tnbc-mrna-vaccine)
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- FIRST check the PAGE INDEX below. If the question maps directly to a known page, use read_page immediately without searching.
- Use search_wiki for broad discovery when you're not sure which page has the answer. Search with a few specific words (names, drugs, tests, dates), not a whole sentence. If a search finds nothing useful, try different words before giving up.
- After searching, read the 2-3 most relevant pages before answering.
- Long pages come back in parts. When read_page returns truncated: true, you have NOT seen the whole page: use its sections list to read_page("slug#anchor") for the part you need, or find_in_page to locate a specific term, rather than assuming the page lacks it.
- When you read a page, check its linked_pages list. Follow links that are directly relevant to the question. Skip generic links unless they're what the user asked about.
- If read_page returns content exactly "unavailable", the page exists but its contents are not available to chat. Say that the source is unavailable instead of treating it as a missing page.
- Do NOT use list_pages — use the PAGE INDEX instead.
- If the wiki does not contain the answer, say so plainly. Never invent results, dates or doses.

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

/** Additional system instructions appended ONLY for authorized wiki editors when a repo is configured. */
export const WIKI_CHAT_EDIT_SYSTEM_PROMPT = `## WIKI EDITING (ADMIN ONLY)
You have access to the \`propose_wiki_edit\` tool to propose body-only edits to existing wiki pages.
- ONLY call \`propose_wiki_edit\` when the user explicitly asks to update or fix a wiki page.
- Read the exact section with \`read_page\` (using \`offset\` or \`#anchor\` on long pages) BEFORE calling \`propose_wiki_edit\`.
- Every \`oldText\` must be copied verbatim from the original page body, match uniquely, and not overlap other edits in the same call.
- Never attempt to edit YAML frontmatter, the primary \`#\` H1 heading, redacted/PII regions, or local asset/embed links (images, PDFs, transclusions).
- Proposing an edit does NOT modify the wiki until the user clicks "Approve & Publish" on the proposal card. Always briefly tell the user to review the diff card and approve or reject it.`;

/** The full system prompt: base rules, then the diagnosis and the page index
 * (both already redacted for the viewer). The route and the eval share it. */
export function composeWikiChatSystemPrompt(
  {
    diagnosis,
    index,
    canEditWiki = false,
  }: { diagnosis?: string | null; index?: string | null; canEditWiki?: boolean },
  base = WIKI_CHAT_SYSTEM_PROMPT_BASE,
) {
  let prompt = base;
  if (canEditWiki) prompt += `\n\n${WIKI_CHAT_EDIT_SYSTEM_PROMPT}`;
  if (diagnosis) prompt += `\n\n## PATIENT DIAGNOSIS\n\n${diagnosis}`;
  if (index) prompt += `\n\n## PAGE INDEX\n\nUse these slugs with read_page to get full content:\n\n${index}`;
  return prompt;
}

export const ChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(z.unknown()).optional(),
        content: z.string().optional(),
      }),
    )
    .min(1, "messages must not be empty"),
  conversationId: z.string().optional(),
  // New clients reset cancellation before exposing a stoppable request. Legacy
  // callers still use the server-side reset during a rolling deployment.
  cancelResetHandled: z.boolean().optional(),
});

export type ChatRequestBody = z.infer<typeof ChatRequestSchema>;

/**
 * Strip the large `content` field from `read_page` tool outputs (and
 * structurally-similar shapes) so persisted message parts don't carry the
 * full page text per call. Used by both the streaming flush path AND the
 * final onFinish save so a completed assistant row matches the in-flight
 * shape.
 */
export function compactChatToolResult(result: unknown): unknown {
  if (
    typeof result === "object" &&
    result !== null &&
    "content" in (result as Record<string, unknown>)
  ) {
    const record = result as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== "content"),
    );
  }
  if (Array.isArray(result)) {
    return (result as Array<Record<string, unknown>>).map((record) => ({
      slug: record.slug,
      title: record.title,
      href: record.href,
      anchor: record.anchor,
    }));
  }
  return result;
}

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "in", "on", "at", "to",
  "for", "of", "with", "and", "or", "but", "not", "from", "by", "about",
  "what", "how", "does", "do", "can", "will", "should", "would", "could",
  "her", "his", "my", "our", "their", "this", "that", "these", "those",
  "it", "they", "we", "you", "i", "me", "she", "he",
  "before", "after", "during", "between", "through", "into", "like",
  "diana", "diana's", "tnbc", "breast", "cancer", "tumor",
  "patient", "doctor", "medical", "clinical", "results",
  "ucsf", "stanford",
]);

const MEDICAL_ABBREVIATION_EXPANSIONS: Record<string, string[]> = {
  tnbc: ["triple-negative breast cancer"],
  pcr: ["pathologic complete response"],
  ctdna: ["circulating tumor DNA", "ctDNA"],
  mrd: ["minimal residual disease"],
  rcb: ["residual cancer burden"],
  hrd: ["homologous recombination deficiency"],
  stils: ["stromal tumor-infiltrating lymphocytes", "sTILs"],
  tmb: ["tumor mutational burden"],
  "keynote-522": ["pembrolizumab chemotherapy neoadjuvant"],
  "k-522": ["KEYNOTE-522"],
  ac: ["doxorubicin cyclophosphamide"],
  pembro: ["pembrolizumab"],
  idc: ["invasive ductal carcinoma"],
  nact: ["neoadjuvant chemotherapy"],
  hbo2t: ["hyperbaric oxygen therapy"],
  pd: ["programmed death ligand"],
  brca: ["BRCA1 BRCA2 germline mutation"],
  her2: ["HER2 erbb2"],
};

const MAX_SEARCH_PATTERNS = 5;

/**
 * Generate up to 5 search-pattern variants of a user query for parallel
 * BM25 fan-out: a cleaned form (stop-words removed), medical-abbreviation
 * expansions, and one or two of the longest individual terms when the
 * cleaned query has 3+ significant words.
 */
export function generateChatSearchPatterns(query: string): string[] {
  const patterns = new Set<string>();
  const clean = query.trim();
  if (!clean) return [];

  const significantWords = clean
    .split(/\s+/)
    .filter(
      (word) => word.length >= 2 && !SEARCH_STOP_WORDS.has(word.toLowerCase()),
    );
  const cleaned = significantWords.join(" ");
  if (cleaned) patterns.add(cleaned);

  const lower = clean.toLowerCase();
  for (const [abbreviation, alternatives] of Object.entries(
    MEDICAL_ABBREVIATION_EXPANSIONS,
  )) {
    if (patterns.size >= MAX_SEARCH_PATTERNS) break;
    if (!lower.includes(abbreviation)) continue;
    for (const alternative of alternatives) {
      if (patterns.size >= MAX_SEARCH_PATTERNS) break;
      patterns.add(alternative);
    }
  }

  if (significantWords.length >= 3) {
    const byLength = [...significantWords].sort((a, b) => b.length - a.length);
    for (const word of byLength.slice(0, 2)) {
      if (patterns.size >= MAX_SEARCH_PATTERNS) break;
      patterns.add(word);
    }
  }

  return Array.from(patterns).slice(0, MAX_SEARCH_PATTERNS);
}

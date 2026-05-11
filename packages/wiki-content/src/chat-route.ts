import { z } from "zod";

/**
 * Canonical Diana chat system prompt used by both the Next chat route and
 * the Vite standalone chat route. Hosts that need a different prompt should
 * pass their own via `loadSystemPrompt` rather than diverge a copy of this
 * constant; the two apps previously kept drifting versions and the chat
 * citation-shape contracts only stay stable when both sides share one source.
 */
export const DIANA_CHAT_SYSTEM_PROMPT_BASE = `You are a research assistant for a triple-negative breast cancer (TNBC) knowledge base. You help answer questions about the patient's diagnosis, treatment plan, research, and related medical topics.

You have access to tools that let you search and read wiki pages. Use them to find relevant information before answering. Always ground your answers in the wiki content when possible.

IMPORTANT CITATION RULES:
- ALWAYS cite sources using compact inline markdown links: [short label](/slug#section-anchor)
- Every factual claim should have a citation. Aim for 5+ citations per response.
- Prefer the most specific page anchor when the source has an obvious heading or section; otherwise cite the page.
- Example: "The treatment plan uses [KEYNOTE-522](/wiki/treatment/treatment-plan#keynote-522), which includes..."
- Cite specific source pages when referencing research: [Sahin 2026](/sources/research-articles/sahin-2026-tnbc-mrna-vaccine)
- Do NOT list sources at the end — weave them inline throughout your response.

Search strategy:
- FIRST check the PAGE INDEX below — if the question maps directly to a known page (e.g. "treatment plan" → wiki/treatment/plan/index, "diagnosis" → wiki/diagnostics/diagnosis), use read_page immediately without searching
- Use search_wiki for broad discovery when you're not sure which page has the answer
- After searching, read the 2-3 most relevant pages before answering
- When you read a page, check its linked_pages list — these are pages referenced in the text. Follow links that are directly relevant to the question (e.g. a treatment page linking to a specific trial or meeting notes). Skip generic links like "diagnosis" or "prognosis" unless they're what the user asked about.
- If read_page returns content exactly "unavailable", the page exists but its contents are not available to chat. Say that the source is unavailable instead of treating it as a missing page.
- Do NOT use list_pages — use the PAGE INDEX instead

Be direct, compassionate, and precise. Use medical terminology but explain it when needed.`;

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

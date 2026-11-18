/** What the reader sends into a "Talk with the page" call. The prompt, model
 * and tools are server-only (server/api/page-talk.ts). The page text arrives
 * over the call's data channel from /api/page-copy, which already applies the
 * reader's access rules and the site's redactions. */
export const PAGE_TALK_GREETING = "Greet the reader in one short, warm sentence that names what the page is about, then ask what they would like to talk through. Do not call tools for this greeting.";

/** Pages can be long transcripts. Every token here is re-read on each audio
 * turn, so a call carries the start of the page and says it was cut. */
export const PAGE_TALK_MAX_CHARS = 24_000;

/** The system note that tells the model which page the reader is on. */
export function pageNote(page: { title: string; slug: string; markdown: string | null }, first: boolean) {
  // The page's own H1 names it better than its file name.
  const title = page.markdown?.match(/^#\s+(.+)$/m)?.[1]?.trim() || page.title;
  const where = `The reader ${first ? "is on" : "has moved to"} the page "${title}" (${page.slug}).`;
  if (page.markdown === null) return `${where} Its text could not be loaded, so say you can't see this page right now if they ask about it.`;
  const text = page.markdown.trim();
  const clipped = text.length > PAGE_TALK_MAX_CHARS;
  const body = clipped ? `${text.slice(0, PAGE_TALK_MAX_CHARS)}\n[The page continues, but the rest was not included.]` : text;
  return `${where}${first ? "" : " Continue the same conversation, connect it to this page in one short sentence if it helps, and do not greet them again."} Page text follows.\n\n${body || "(This page is empty.)"}`;
}

export const LEFT_PAGE_NOTE = "The reader has left the wiki page and is now on a screen with no page text. Keep talking about what you discussed.";

import { createHash } from "node:crypto";

export const HTML_RENDERER_VERSION = "public-reader-2";
export type RenderablePage = { slug: string; content: string; contentHash?: string | null };

/** Cache CPU work only. The caller must look up visibility and redact first. */
export function createHtmlPageCache(render: (page: RenderablePage) => string,
  limits = { entries: 8, entryBytes: 512_000, totalBytes: 2_048_000 }) {
  const entries = new Map<string, { html: string; bytes: number }>();
  let bytes = 0;
  const evict = () => {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) { bytes -= entries.get(oldest)!.bytes; entries.delete(oldest); }
  };
  return (siteSlug: string, page: RenderablePage) => {
    // Hash actual redacted bytes: changing PII rules must not reuse the old
    // rendering when the publisher's source contentHash stays unchanged.
    const key = createHash("sha256").update(JSON.stringify([
      HTML_RENDERER_VERSION, siteSlug, page.slug, page.contentHash, page.content,
    ])).digest("hex");
    const hit = entries.get(key);
    if (hit) { entries.delete(key); entries.set(key, hit); return hit.html; }
    const html = render(page);
    const size = Buffer.byteLength(html);
    if (size <= limits.entryBytes && size <= limits.totalBytes) {
      while (entries.size && (entries.size >= limits.entries || bytes + size > limits.totalBytes)) evict();
      entries.set(key, { html, bytes: size }); bytes += size;
    }
    return html;
  };
}

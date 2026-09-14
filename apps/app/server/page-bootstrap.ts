import { WIKI_READER_CACHE_VERSION } from "@oncobase/wiki-content";
import { MAX_BOOTSTRAP_BYTES, PAGE_BOOTSTRAP_ID, serializePageBootstrap } from "../src/bootstrap/page-payload";

type PublicPage = {
  slug: string; title: string; content: string; contentHash?: string | null;
  sensitive?: boolean; tags?: string[];
};

/** Data only: React remains responsible for rendering the article. Call only
 * after the request gate and the same redaction policy as the page API. */
export function injectPageBootstrap(html: string, page: PublicPage, url: URL, siteSlug: string,
  options: { publicSessionVerified?: boolean } = {}) {
  if (page.sensitive !== false || !page.contentHash || !page.content ||
      !html.includes('</body>') || html.includes(`id="${PAGE_BOOTSTRAP_ID}"`)) return html;
  // Bound work before serialization as well as the escaped wire payload.
  if (Buffer.byteLength(page.content) > MAX_BOOTSTRAP_BYTES) return html;
  const payload = serializePageBootstrap({
    version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
    origin: url.origin, pathname: url.pathname, siteSlug, scope: "public",
    ...(options.publicSessionVerified ? { publicSessionVerified: true as const } : {}),
    page: { slug: page.slug, title: page.title, content: page.content,
      contentHash: page.contentHash, tags: page.tags ?? [], sensitive: false,
      size: Buffer.byteLength(page.content) },
  });
  if (Buffer.byteLength(payload) > MAX_BOOTSTRAP_BYTES) return html;
  // Stamp receipt in the browser, so shared HTML never carries a stale server
  // timestamp. Module scripts execute after this parser-inserted data block.
  const data = `<script id="${PAGE_BOOTSTRAP_ID}" type="application/json">${payload}</script>`;
  const stamp = `<script>document.getElementById("${PAGE_BOOTSTRAP_ID}").dataset.receivedAt=String(Date.now())</script>`;
  return html.replace('</body>', () => `${data}${stamp}</body>`);
}

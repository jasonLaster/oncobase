import { buildFileTreeFromManifest, compactFileTree, WIKI_READER_CACHE_VERSION, type CompactFileNode, type FileNode, type WikiSessionIdentity } from "@oncobase/wiki-content";
import { MAX_BOOTSTRAP_BYTES, NAVIGATION_BOOTSTRAP_ID, PAGE_BOOTSTRAP_ID, serializePageBootstrap, type SessionPageBootstrap } from "../src/bootstrap/page-payload";

type PublicPage = {
  slug: string; title: string; content: string; contentHash?: string | null;
  sensitive?: boolean; tags?: string[];
};

/** Data only: React remains responsible for rendering the article. Call only
 * after the request gate and the same redaction policy as the page API. */
export function injectPageBootstrap(html: string, page: PublicPage, url: URL, siteSlug: string,
  options: { publicSessionVerified?: boolean; publicAccessPartition?: "education" } = {}) {
  if (page.sensitive !== false || !page.contentHash || !page.content ||
      !html.includes('</body>') || html.includes(`id="${PAGE_BOOTSTRAP_ID}"`)) return html;
  // Bound work before serialization as well as the escaped wire payload.
  if (Buffer.byteLength(page.content) > MAX_BOOTSTRAP_BYTES) return html;
  const payload = serializePageBootstrap({
    version: 1, readerVersion: WIKI_READER_CACHE_VERSION,
    origin: url.origin, pathname: url.pathname, siteSlug, scope: "public",
    ...(options.publicSessionVerified ? { publicSessionVerified: true as const } : {}),
    ...(options.publicAccessPartition ? { publicAccessPartition: options.publicAccessPartition } : {}),
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

type SessionPage = { slug: string; title: string; content: string; contentHash: string | null;
  sensitive: boolean; tags: string[]; size: number };

/** A data block plus its receipt stamp (the browser's clock, never the server's). */
function dataScripts(id: string, payload: string) {
  return `<script id="${id}" type="application/json">${payload}</script>` +
    `<script>document.getElementById("${id}").dataset.receivedAt=String(Date.now())</script>`;
}

/**
 * A signed-in document's payload: the session API's identity and the page
 * API's record, both obtained by dispatching this same request (same cookies
 * and headers) to those handlers. It inlines nothing the request could not
 * read itself, in a response that is already private and no-store.
 */
export function sessionPageBootstrapScripts(identity: WikiSessionIdentity, page: SessionPage, url: URL, siteSlug: string): string | null {
  if (identity.scope !== "session" || !identity.authenticated || !identity.userHash || identity.siteSlug !== siteSlug ||
      !page.contentHash || !page.content) return null;
  if (Buffer.byteLength(page.content) > MAX_BOOTSTRAP_BYTES) return null;
  const payload = serializePageBootstrap({
    version: 2, readerVersion: WIKI_READER_CACHE_VERSION,
    origin: url.origin, pathname: url.pathname, siteSlug, scope: "session", identity,
    page: { slug: page.slug, title: page.title, content: page.content, contentHash: page.contentHash,
      tags: page.tags, sensitive: page.sensitive, size: page.size },
  } satisfies SessionPageBootstrap);
  return Buffer.byteLength(payload) > MAX_BOOTSTRAP_BYTES ? null : dataScripts(PAGE_BOOTSTRAP_ID, payload);
}

export function injectSessionPageBootstrap(html: string, identity: WikiSessionIdentity, page: SessionPage, url: URL, siteSlug: string) {
  if (!html.includes("</body>") || html.includes(`id="${PAGE_BOOTSTRAP_ID}"`)) return html;
  const scripts = sessionPageBootstrapScripts(identity, page, url, siteSlug);
  return scripts ? html.replace("</body>", () => `${scripts}</body>`) : html;
}

/**
 * The tree's first paint: every top-level entry plus each ancestor directory
 * of the current page with its direct children. Directories off that path
 * are listed without children; the full manifest fills them in after paint.
 */
export function navigationSlice(slugs: Iterable<string>, currentSlug: string): CompactFileNode[] {
  const ancestors = new Set<string>();
  const parts = currentSlug.split("/").filter(Boolean);
  for (let depth = 1; depth < parts.length; depth++) ancestors.add(parts.slice(0, depth).join("/"));
  const prune = (nodes: FileNode[]): FileNode[] => nodes.map(node => node.type !== "directory" ? node
    : { ...node, children: ancestors.has(node.slug) ? prune(node.children ?? []) : [] });
  const tree = buildFileTreeFromManifest([...new Set([...slugs, currentSlug])].map(slug => ({ slug })));
  return compactFileTree(prune(tree));
}

export function navigationBootstrapScripts(tree: CompactFileNode[], url: URL, siteSlug: string,
  binding: { scope: "public" } | { scope: "session"; identity: WikiSessionIdentity }): string | null {
  const payload = serializePageBootstrap({
    version: 1, readerVersion: WIKI_READER_CACHE_VERSION, origin: url.origin, pathname: url.pathname, siteSlug,
    scope: binding.scope, ...(binding.scope === "session" ? { identityKey: binding.identity.cacheKey } : {}), tree,
  });
  // A slice is small; a pathological listing keeps the manifest-only path.
  return Buffer.byteLength(payload) > 64 * 1024 ? null : dataScripts(NAVIGATION_BOOTSTRAP_ID, payload);
}

export function injectNavigationBootstrap(html: string, tree: CompactFileNode[], url: URL, siteSlug: string,
  binding: { scope: "public" } | { scope: "session"; identity: WikiSessionIdentity }) {
  if (!html.includes("</body>") || html.includes(`id="${NAVIGATION_BOOTSTRAP_ID}"`)) return html;
  const scripts = navigationBootstrapScripts(tree, url, siteSlug, binding);
  return scripts ? html.replace("</body>", () => `${scripts}</body>`) : html;
}

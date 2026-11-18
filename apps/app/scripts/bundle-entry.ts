/**
 * The entry chunk, by identity rather than by name: `index-*.js` also matches
 * any dependency chunk rolldown names after a package's `index` module (swr's
 * `dist/index/index.mjs` builds as `index-<hash>.js`), which the bundle budget
 * used to count as paint-critical. Read the document's module script; the
 * Vercel build deletes dist/index.html before the budget runs
 * (WIKI_VITE_EMBED_APP_SHELL), so fall back to the one `index-*` chunk that
 * holds main.tsx's `vite:preloadError` recovery.
 */
export function entryChunkName(html: string | null, chunks: { name: string; source: () => string }[]) {
  const fromHtml = html?.match(/<script type="module"[^>]*\ssrc="\/assets\/([^"]+\.js)"/)?.[1];
  if (fromHtml) return fromHtml;
  const candidates = chunks.filter(chunk => /^index-[\w-]+\.js$/.test(chunk.name) && chunk.source().includes("vite:preloadError"));
  if (candidates.length !== 1) throw new Error(`expected one entry chunk, found ${candidates.map(chunk => chunk.name).join(", ") || "none"}`);
  return candidates[0]!.name;
}

export const exactName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

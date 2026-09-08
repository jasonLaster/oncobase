import { buildFileTreeFromManifest, type FileNode, type WikiManifest } from "@oncobase/wiki-content";
import type { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Render the visible branch, with native links for expanding other folders.
 * Shipping thousands of hidden rows delays both first paint and app startup. */
export function renderReaderNavigation(tree: FileNode[], activeSlug: string, url = new URL(activeSlug === "index" ? "/" : "/" + activeSlug, "https://reader.invalid")): string {
  const expanded = url.searchParams.get("tree") ?? "";
  const visit = (nodes: FileNode[]): string => nodes.map(node => {
    const label = escape(node.name.replace(/-/g, " "));
    if (node.type === "directory") {
      const open = activeSlug.startsWith(node.slug + "/") || expanded === node.slug || expanded.startsWith(node.slug + "/");
      if (!open) {
        const destination = new URL(url);
        destination.searchParams.set("tree", node.slug);
        return `<a class="html-first-folder" data-folder="${escape(node.slug)}" href="${escape(destination.pathname + destination.search + destination.hash)}"><span aria-hidden="true">▶ </span>${label}</a>`;
      }
      return `<details data-folder="${escape(node.slug)}" open><summary>${label}</summary><div class="html-first-tree-children">${visit(node.children ?? [])}</div></details>`;
    }
    const href = node.type === "pdf" ? `/api/file?path=${encodeURIComponent(node.pdfPath ?? node.slug)}`
      : node.slug === "index" ? "/" : "/" + node.slug.split("/").map(encodeURIComponent).join("/");
    return `<a href="${escape(href)}"${node.slug === activeSlug ? ' aria-current="page"' : ""}>${label}${node.type === "pdf" ? ".pdf" : ""}</a>`;
  }).join("");
  return visit(tree);
}

/** The published public manifest is already filtered; never use a session tree
 * in HTML shared by readers. Cache only against the complete site revision. */
export function createReaderNavigation(client: ConvexHttpClient) {
  const entries = new Map<string, Promise<FileNode[]>>();
  return (siteSlug: string, revision: string): Promise<FileNode[]> => {
    const key = JSON.stringify([siteSlug, revision]);
    const cached = entries.get(key);
    if (cached) return cached;
    const pending = (async () => {
      const snapshot = await client.query(api.manifestCache.current, { siteSlug, serverSecret: process.env.WIKI_PREFETCH_SECRET! });
      if (!snapshot) throw new Error("Reader navigation snapshot unavailable");
      const response = await fetch(snapshot.url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Reader navigation snapshot unavailable");
      const manifest = await response.json() as WikiManifest;
      if (manifest.siteSlug !== siteSlug || manifest.scope !== "public" || !Array.isArray(manifest.pages)) throw new Error("Invalid reader navigation snapshot");
      // Build from visibility metadata instead of trusting precomputed tree rows.
      return buildFileTreeFromManifest(manifest.pages.filter(page => page.sensitive === false), manifest.assets ?? []);
    })();
    entries.set(key, pending);
    while (entries.size > 8) entries.delete(entries.keys().next().value!);
    pending.catch(() => { if (entries.get(key) === pending) entries.delete(key); });
    return pending;
  };
}

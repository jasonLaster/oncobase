import { createFastReader } from "../server/fast-reader";

declare const __WIKI_VITE_INDEX_HTML__: string;
declare const __WIKI_CRITICAL_CSS__: string;

const read = createFastReader({ indexHtml: __WIKI_VITE_INDEX_HTML__, criticalCss: __WIKI_CRITICAL_CSS__ });

export default async function edgeReader(request: Request) {
  if (process.env.WIKI_HTML_FIRST === "1") {
    try {
      const response = await read(request);
      if (response) {
        response.headers.set("X-Wiki-Reader", "html-first-edge-1");
        return response;
      }
    } catch { /* The regular route repeats its own access checks on fallback. */ }
  }
  return new Response(null, { headers: { "x-middleware-next": "1" } });
}

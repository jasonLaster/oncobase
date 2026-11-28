import { fileURLToPath } from "node:url";
import { createWikiViteHandler } from "./app-shell.js";
import { isDataOverlayHost, rawRequestPath } from "./data-overlay/host.js";

// WIKI_DIST_DIR lets the local stack serve a build pointed at its own backend
// without replacing the default dist used by production-style verification.
const distDir = process.env.WIKI_DIST_DIR || fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 62003);
const handleRequest = createWikiViteHandler({ distDir });

Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    try {
      // Mirrors vercel.json: data.diana-tnbc.com (data.localhost locally) is
      // the data overlay, not the wiki.
      if (isDataOverlayHost(request.headers.get("host"))) {
        const { handleDataOverlayRequest } = await import("./data-overlay/entry.js");
        return await handleDataOverlayRequest(request, rawRequestPath(request.url));
      }
      return await handleRequest(request);
    } catch (error) {
      console.error("[wiki-vite-server]", error);
      return Response.json({ error: "Wiki Vite server failed" }, { status: 500 });
    }
  },
});

console.log(`Wiki Vite server listening on http://127.0.0.1:${port}`);

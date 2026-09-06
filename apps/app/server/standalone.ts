import { fileURLToPath } from "node:url";
import { createWikiViteHandler } from "./app-shell.js";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 62003);
const handleRequest = createWikiViteHandler({ distDir });

Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    try {
      return await handleRequest(request);
    } catch (error) {
      console.error("[wiki-vite-server]", error);
      return Response.json({ error: "Wiki Vite server failed" }, { status: 500 });
    }
  },
});

console.log(`Wiki Vite server listening on http://127.0.0.1:${port}`);

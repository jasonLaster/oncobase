import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWikiApiHandler } from "./wiki-api";

const distDir = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT ?? 62003);
const handleWikiApiRequest = createWikiApiHandler();

const STATIC_MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function staticHeaders(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    "Content-Type": STATIC_MIME_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": filePath.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
}

function safeStaticPath(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(distDir, normalized);
}

async function serveStatic(request: Request) {
  const url = new URL(request.url);
  const directPath = safeStaticPath(url.pathname === "/" ? "/index.html" : url.pathname);
  const hasExtension = path.extname(url.pathname) !== "";
  const directFileExists = existsSync(directPath) && !directPath.endsWith(path.sep);
  const filePath = directFileExists ? directPath : path.join(distDir, "index.html");

  if (!existsSync(filePath)) {
    return new Response("Vite build output not found. Run bun --cwd apps/wiki-vite build first.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!directFileExists && hasExtension) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(Bun.file(filePath), {
    headers: staticHeaders(filePath),
  });
}

Bun.serve({
  port,
  async fetch(request) {
    try {
      const apiResponse = await handleWikiApiRequest(request);
      if (apiResponse) return apiResponse;
      return await serveStatic(request);
    } catch (error) {
      console.error("[wiki-vite-server]", error);
      return Response.json({ error: "Wiki Vite server failed" }, { status: 500 });
    }
  },
});

console.log(`Wiki Vite server listening on http://127.0.0.1:${port}`);

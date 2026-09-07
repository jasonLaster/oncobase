import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createFastReader } from "../server/fast-reader";
import { requestFromIncoming, sendWebResponse } from "../server/http-adapter";
import { isInternalReaderPath, verifyReaderContext } from "../server/reader-cache-context";

declare const __WIKI_VITE_INDEX_HTML__: string;
declare const __WIKI_CRITICAL_CSS__: string;

const distDir = path.join(process.cwd(), "apps/app/dist");
const fastReader = createFastReader({ indexHtml: __WIKI_VITE_INDEX_HTML__, criticalCss: __WIKI_CRITICAL_CSS__ });
let fallback: Promise<(request: Request) => Promise<Response>>;
async function handleWikiViteRequest(request: Request, fingerprint?: string) {
  if (process.env.WIKI_HTML_FIRST === "1") {
    try {
      const response = await fastReader(request, fingerprint);
      if (response) return response;
    } catch { /* The existing handler still enforces access on fallback. */ }
  }
  fallback ??= import("../server/app-shell").then(({ createWikiViteHandler }) => createWikiViteHandler({
    distDir, indexHtml: __WIKI_VITE_INDEX_HTML__, criticalCss: __WIKI_CRITICAL_CSS__,
  }));
  const response = await (await fallback)(request);
  if (fingerprint) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vercel-CDN-Cache-Control", "no-store");
  }
  return response;
}

function restoreRewrittenPath(request: Request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get("__path");
  if (rewrittenPath == null) return request;

  url.pathname = rewrittenPath ? `/${rewrittenPath.replace(/^\/+/, "")}` : "/";
  url.searchParams.delete("__path");

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit);
}

export default async function wikiViteRootAppShell(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    let request = restoreRewrittenPath(await requestFromIncoming(req));
    let fingerprint: string | undefined;
    if (isInternalReaderPath(new URL(request.url).pathname)) {
      const context = await verifyReaderContext(request, process.env.WIKI_GATE_SESSION_SECRET?.trim());
      if (!context || !["GET", "HEAD"].includes(request.method)) {
        await sendWebResponse(res, new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } }));
        return;
      }
      fingerprint = context.fingerprint;
      request = new Request(context.url, { method: request.method, headers: request.headers, signal: request.signal });
    }
    await sendWebResponse(res, await handleWikiViteRequest(request, fingerprint));
  } catch (error) {
    console.error("[wiki-vite-vercel-root-app]", error);
    await sendWebResponse(
      res,
      Response.json({ error: "Wiki Vite app failed" }, { status: 500 }),
    );
  }
}

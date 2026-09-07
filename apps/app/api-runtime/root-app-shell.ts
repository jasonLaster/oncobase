import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createFastReader } from "../server/fast-reader";
import { requestFromIncoming, sendWebResponse } from "../server/http-adapter";

declare const __WIKI_VITE_INDEX_HTML__: string;
declare const __WIKI_CRITICAL_CSS__: string;

const distDir = path.join(process.cwd(), "apps/app/dist");
const fastReader = createFastReader({ indexHtml: __WIKI_VITE_INDEX_HTML__, criticalCss: __WIKI_CRITICAL_CSS__ });
let fallback: Promise<(request: Request) => Promise<Response>>;
async function handleWikiViteRequest(request: Request) {
  if (process.env.WIKI_HTML_FIRST === "1") {
    try {
      const response = await fastReader(request);
      if (response) return response;
    } catch { /* The existing handler still enforces access on fallback. */ }
  }
  fallback ??= import("../server/app-shell").then(({ createWikiViteHandler }) => createWikiViteHandler({
    distDir, indexHtml: __WIKI_VITE_INDEX_HTML__, criticalCss: __WIKI_CRITICAL_CSS__,
  }));
  return (await fallback)(request);
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
    const request = restoreRewrittenPath(await requestFromIncoming(req));
    await sendWebResponse(res, await handleWikiViteRequest(request));
  } catch (error) {
    console.error("[wiki-vite-vercel-root-app]", error);
    await sendWebResponse(
      res,
      Response.json({ error: "Wiki Vite app failed" }, { status: 500 }),
    );
  }
}

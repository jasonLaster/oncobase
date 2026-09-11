import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { requestFromIncoming, sendWebResponse } from "../server/http-adapter";
import { isInternalReaderPath } from "../server/reader-cache-context";

declare const __WIKI_VITE_INDEX_HTML__: string;
const distDir = path.join(process.cwd(), "apps/app/dist");
let handler: Promise<(request: Request) => Promise<Response>>;
async function handleWikiViteRequest(request: Request) {
  // All reader UI is client rendered. Legacy HTML flags cannot re-enable a handoff.
  handler ??= import("../server/app-shell").then(({ createWikiViteHandler }) => createWikiViteHandler({
    distDir, indexHtml: __WIKI_VITE_INDEX_HTML__, htmlFirstExperiment: false,
  }));
  return (await handler)(request);
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
    if (isInternalReaderPath(new URL(request.url).pathname)) {
      await sendWebResponse(res, new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } }));
      return;
    }
    await sendWebResponse(res, await handleWikiViteRequest(request));
  } catch (error) {
    console.error("[wiki-vite-vercel-root-app]", error);
    await sendWebResponse(
      res,
      Response.json({ error: "Wiki Vite app failed" }, { status: 500 }),
    );
  }
}

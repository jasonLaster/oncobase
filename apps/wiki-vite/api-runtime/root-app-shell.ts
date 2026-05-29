import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createWikiViteHandler } from "../server/app-shell.js";
import { requestFromIncoming, sendWebResponse } from "../server/wiki-api.js";

const distDir = path.join(process.cwd(), "apps/wiki-vite/dist");
const handleWikiViteRequest = createWikiViteHandler({ distDir });

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

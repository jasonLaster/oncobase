import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createClient,
  createWikiApiHandler,
  requestFromIncoming,
  sendWebResponse,
} from "../server/wiki-api.js";

const handleWikiApiRequest = createWikiApiHandler(createClient());

export const config = {
  maxDuration: 60,
};

function restoreRewrittenPath(request: Request) {
  const url = new URL(request.url);
  const rewrittenPath = url.searchParams.get("__path");
  if (rewrittenPath == null) return request;

  url.pathname = `/${rewrittenPath.replace(/^\/+/, "")}`;
  url.searchParams.delete("__path");

  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit);
}

export default async function wikiViteApi(req: IncomingMessage, res: ServerResponse) {
  try {
    const request = restoreRewrittenPath(await requestFromIncoming(req));
    const response = await handleWikiApiRequest(request);
    await sendWebResponse(
      res,
      response ?? new Response("Not found", { status: 404 }),
    );
  } catch (error) {
    console.error("[wiki-vite-vercel-api]", error);
    await sendWebResponse(
      res,
      Response.json({ error: "Wiki Vite API failed" }, { status: 500 }),
    );
  }
}

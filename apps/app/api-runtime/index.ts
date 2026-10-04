import { flushBackendTraces } from "../server/backend-tracing";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient, createWikiApiHandler } from "../server/wiki-api.js";
import { requestFromIncoming, restoreRewrittenPath, sendWebResponse } from "../server/http-adapter";
import { internalReaderNotFound, isInternalReaderPath } from "../server/reader-cache-context";

const handleWikiApiRequest = createWikiApiHandler(createClient());

export default async function wikiViteApi(req: IncomingMessage, res: ServerResponse) {
  try {
    const request = restoreRewrittenPath(await requestFromIncoming(req));
    if (isInternalReaderPath(new URL(request.url).pathname)) {
      await sendWebResponse(res, internalReaderNotFound());
      return;
    }
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
  } finally {
    await flushBackendTraces();
  }
}

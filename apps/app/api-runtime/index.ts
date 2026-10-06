import { flushBackendTraces } from "../server/backend-tracing";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createClient, createWikiApiHandler } from "../server/wiki-api.js";
import {
  RequestBodyTooLargeError,
  requestBodyTooLargeResponse,
  requestFromIncoming,
  restoreRewrittenPath,
  sendWebResponse,
} from "../server/http-adapter";
import { isMarketingRequest } from "../server/marketing-host";
import { internalReaderNotFound, isInternalReaderPath } from "../server/reader-cache-context";

const handleWikiApiRequest = createWikiApiHandler(createClient());

export default async function wikiViteApi(req: IncomingMessage, res: ServerResponse) {
  try {
    const request = restoreRewrittenPath(await requestFromIncoming(req));
    if (isInternalReaderPath(new URL(request.url).pathname)) {
      await sendWebResponse(res, internalReaderNotFound());
      return;
    }
    // oncobase.io is the marketing site: it has no wiki and no API, so nothing here may answer for it.
    if (isMarketingRequest(request)) {
      await sendWebResponse(
        res,
        new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8", Vary: "Host" } }),
      );
      return;
    }
    const response = await handleWikiApiRequest(request);
    await sendWebResponse(
      res,
      response ?? new Response("Not found", { status: 404 }),
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      await sendWebResponse(res, requestBodyTooLargeResponse());
      return;
    }
    console.error("[wiki-vite-vercel-api]", error);
    await sendWebResponse(
      res,
      Response.json({ error: "Wiki Vite API failed" }, { status: 500 }),
    );
  } finally {
    await flushBackendTraces();
  }
}

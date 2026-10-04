import { flushBackendTraces, traceBackendHandler, traceBackendPhase } from "../server/backend-tracing";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  RequestBodyTooLargeError,
  requestBodyTooLargeResponse,
  requestFromIncoming,
  restoreRewrittenPath,
  sendWebResponse,
} from "../server/http-adapter";
import { internalReaderNotFound, isInternalReaderPath } from "../server/reader-cache-context";

declare const __WIKI_VITE_INDEX_HTML__: string;
const distDir = path.join(process.cwd(), "apps/app/dist");
let handler: Promise<(request: Request) => Promise<Response>> | undefined;
async function handleWikiViteRequest(request: Request) {
  // All reader UI is client rendered.
  // The lazy import is cold-start cost; attribute it to the first request.
  handler ??= traceBackendPhase("shell.init", () => import("../server/app-shell")).then(({ createWikiViteHandler }) => createWikiViteHandler({
    distDir, indexHtml: __WIKI_VITE_INDEX_HTML__,
  })).catch((error) => {
    // A transient failure must not poison this instance for its lifetime.
    handler = undefined;
    throw error;
  });
  return (await handler)(request);
}

const tracedShell = traceBackendHandler(handleWikiViteRequest, { route: "/reader/shell" });

export default async function wikiViteRootAppShell(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    const request = restoreRewrittenPath(await requestFromIncoming(req));
    if (isInternalReaderPath(new URL(request.url).pathname)) {
      await sendWebResponse(res, internalReaderNotFound());
      return;
    }
    await sendWebResponse(res, (await tracedShell(request))!);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      await sendWebResponse(res, requestBodyTooLargeResponse());
      return;
    }
    console.error("[wiki-vite-vercel-root-app]", error);
    await sendWebResponse(
      res,
      Response.json({ error: "Wiki Vite app failed" }, { status: 500 }),
    );
  } finally {
    await flushBackendTraces();
  }
}

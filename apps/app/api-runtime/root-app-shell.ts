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
import { isDataOverlayHost, rawRequestPath } from "../server/data-overlay/host";

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
    const incoming = await requestFromIncoming(req);
    // data.diana-tnbc.com: S3 presigned redirects (specs/data-overlay.md).
    // Read the client's path from the raw URL; restoring it through the URL
    // parser would resolve `..` before the overlay can reject it.
    if (isDataOverlayHost(incoming.headers.get("host"))) {
      const { handleDataOverlayRequest } = await import("../server/data-overlay/entry");
      await sendWebResponse(res, await handleDataOverlayRequest(incoming, rawRequestPath(req.url ?? "/")));
      return;
    }
    const request = restoreRewrittenPath(incoming);
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

import { next } from "@vercel/functions/middleware";
import { isInternalReaderPath, READER_CONTEXT_HEADER, READER_VERSION_HEADER } from "./reader-cache-context";

// The application handler enforces authentication. Never rewrite requests into
// the retired HTML cache, even if its deployment flags remain configured.
export function clientReaderGate(request: Request) {
  if (isInternalReaderPath(new URL(request.url).pathname)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }
  const headers = new Headers(request.headers);
  headers.delete(READER_CONTEXT_HEADER);
  headers.delete(READER_VERSION_HEADER);
  return next({ request: { headers } });
}

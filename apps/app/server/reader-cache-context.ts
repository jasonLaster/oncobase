// The retired HTML cache lived under /__reader/. Both Vercel functions and the
// standalone server must keep answering 404 there so no old CDN entry or
// crafted rewrite can reach an application handler.
export function isInternalReaderPath(pathname: string) {
  try { return decodeURIComponent(pathname).toLowerCase().startsWith("/__reader/"); }
  catch { return true; }
}

export function internalReaderNotFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

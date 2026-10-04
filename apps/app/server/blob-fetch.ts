// Blob reads stream large files (PDFs, DICOM) straight to the client, so a
// whole-request timeout would cut off legitimate slow downloads. Bound only
// the wait for response headers, and stop the upstream read when the caller
// (normally the incoming request) aborts.
const DEFAULT_BLOB_HEADER_TIMEOUT_MS = 10_000;

export function blobHeaderTimeoutMs(env: Record<string, string | undefined> = process.env) {
  const raw = env.WIKI_BLOB_HEADER_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_BLOB_HEADER_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_BLOB_HEADER_TIMEOUT_MS;
}

export async function fetchBlob(
  url: string,
  init: { headers?: HeadersInit; signal?: AbortSignal | null } = {},
  { headerTimeoutMs = blobHeaderTimeoutMs(), fetchImpl = fetch }: { headerTimeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const controller = new AbortController();
  const caller = init.signal ?? undefined;
  const forward = () => controller.abort(caller?.reason);
  if (caller?.aborted) forward();
  else caller?.addEventListener("abort", forward, { once: true });
  const timer = headerTimeoutMs > 0
    ? setTimeout(() => controller.abort(new DOMException(`Blob response headers not received within ${headerTimeoutMs}ms`, "TimeoutError")), headerTimeoutMs)
    : undefined;
  try {
    return await fetchImpl(url, { headers: init.headers, signal: controller.signal });
  } catch (error) {
    caller?.removeEventListener("abort", forward);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

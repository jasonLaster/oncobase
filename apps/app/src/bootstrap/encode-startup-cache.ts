import { STARTUP_CACHE_MAX_DECODED_BYTES, type StartupSnapshot } from "./reader-startup-cache";

/** Browser compression runs after paint; the small decoder is synchronous on
 * the next visit. Small snapshots remain plain JSON for the cheapest read. */
export async function encodeStartupSnapshot(snapshot: StartupSnapshot): Promise<string | null> {
  const raw = JSON.stringify(snapshot);
  if (raw.length < 256 * 1024) return raw;
  const blob = new Blob([raw]);
  if (blob.size > STARTUP_CACHE_MAX_DECODED_BYTES) return null;
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `gz1:${btoa(binary)}`;
}

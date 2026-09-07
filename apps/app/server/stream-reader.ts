import { createGzip, constants } from "node:zlib";

/** Flush a valid first HTML fragment before doing the remaining render work. */
export function streamReaderGzip(first: string, remaining: () => string, schedule: (run: () => void) => unknown = setImmediate) {
  const gzip = createGzip({ level: 6 });
  let cancelled = false;
  return new ReadableStream<BufferSource>({
    start(controller) {
      gzip.on("data", chunk => { if (!cancelled) controller.enqueue(new Uint8Array(chunk)); });
      gzip.on("end", () => { if (!cancelled) controller.close(); });
      gzip.on("error", error => { if (!cancelled) controller.error(error); });
      gzip.write(first);
      gzip.flush(constants.Z_SYNC_FLUSH, () => {
        // Give the HTTP adapter a chance to write the prefix to the socket.
        schedule(() => {
          if (cancelled) return;
          try { gzip.end(remaining()); }
          catch (error) { gzip.destroy(error instanceof Error ? error : new Error("Reader render failed")); }
        });
      });
    },
    cancel() { cancelled = true; gzip.destroy(); },
  });
}

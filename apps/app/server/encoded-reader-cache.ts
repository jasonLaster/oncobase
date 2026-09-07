import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/** Cache encoding work after the caller has checked access and redacted. */
export function createEncodedReaderCache() {
  const entries = new Map<string, Uint8Array<ArrayBuffer>>();
  let bytes = 0;
  return (representation: unknown, render: () => string) => {
    const key = createHash("sha256").update(JSON.stringify(representation)).digest("hex");
    const cached = entries.get(key);
    if (cached) { entries.delete(key); entries.set(key, cached); return cached; }
    const encoded = new Uint8Array(gzipSync(render(), { level: 6 }));
    if (encoded.byteLength <= 512_000) {
      while (entries.size && (entries.size >= 16 || bytes + encoded.byteLength > 2_048_000)) {
        const oldest = entries.keys().next().value!;
        bytes -= entries.get(oldest)!.byteLength; entries.delete(oldest);
      }
      entries.set(key, encoded); bytes += encoded.byteLength;
    }
    return encoded;
  };
}

export function acceptsGzip(header: string | null) {
  return (header ?? "").split(",").some(part => {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    if (name !== "gzip") return false;
    const q = parameters.find(p => p.trim().startsWith("q="))?.trim().slice(2);
    return q === undefined || (Number.isFinite(Number(q)) && Number(q) > 0);
  });
}

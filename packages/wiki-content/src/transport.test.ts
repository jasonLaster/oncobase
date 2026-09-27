import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { compactWikiManifest, createWikiContentClient, parseWikiManifest, type WikiManifest } from "./index";

const manifest: WikiManifest = {
  schemaVersion: 1, siteSlug: "fixture", scope: "session", manifestHash: "revision", generatedAt: "2026-09-15T00:00:00Z",
  compactTree: [["d", "notes", [["f", "résumé"]], "3", "wiki/notes"]],
  pages: [{ slug: "wiki/notes/résumé", title: "Résumé 🧬", tags: ["one", "two"], description: null, contentHash: null, sensitive: true, size: 123 }],
  assets: [{ kind: "pdf", path: "notes/résumé.pdf", contentHash: "pdf-hash", size: null }],
};

describe("compact manifest transport", () => {
  test("round trips every field without changing the durable schema or validator", () => {
    expect(parseWikiManifest(JSON.parse(JSON.stringify(compactWikiManifest(manifest))))).toEqual(manifest);
    expect(parseWikiManifest(manifest)).toEqual(manifest);
  });
  test("rejects unknown formats, truncated rows and invalid access metadata", () => {
    const compact = compactWikiManifest(manifest);
    expect(() => parseWikiManifest({ ...compact, wireFormat: "compact-v2" })).toThrow("wireFormat");
    expect(() => parseWikiManifest({ ...compact, pages: [["slug"]] })).toThrow("compact manifest page");
    expect(() => parseWikiManifest({ ...compact, pages: [["slug", "title", [], null, null, 1, 1]] })).toThrow("boolean");
  });
  test("reduces both raw and compressed bytes on a large synthetic page list", () => {
    const large = { ...manifest, pages: Array.from({ length: 5000 }, (_, i) => ({ ...manifest.pages[0]!, slug: `wiki/notes/${i}`, title: `Note ${i}` })) };
    const legacy = JSON.stringify(large);
    const compact = JSON.stringify(compactWikiManifest(large));
    expect(compact.length).toBeLessThan(legacy.length * 0.65);
    expect(gzipSync(compact).length).toBeLessThan(gzipSync(legacy).length);
  });
});

test("reports partial downloads before EOF, handles split UTF-8, and accepts legacy servers", async () => {
  for (const payload of [manifest, compactWikiManifest(manifest)]) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    let finish!: () => void;
    const lastChunk = new Promise<void>(resolve => { finish = resolve; });
    const received: number[] = [];
    let settled = false;
    const client = createWikiContentClient({ fetch: (async (url: Parameters<typeof fetch>[0]) => {
      expect(String(url)).toContain("format=compact-v1");
      return new Response(new ReadableStream({ async start(controller) {
        // Single-byte chunks deliberately split the accented text and emoji.
        for (const byte of bytes.subarray(0, bytes.length - 1)) controller.enqueue(Uint8Array.of(byte));
        await lastChunk;
        controller.enqueue(bytes.subarray(-1));
        controller.close();
      } }), { headers: { "Content-Length": "10", "Content-Encoding": "gzip" } });
    }) as unknown as typeof fetch });
    const pending = client.validateManifest(undefined, value => received.push(value)).then(result => { settled = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toBeLessThan(bytes.length);
    finish();
    const result = await pending;
    expect(result).toEqual({ status: "modified", manifest, partial: false });
    expect(received.at(-1)).toBe(bytes.length);
    expect(settled).toBe(true);
  }
});

test("a truncated streamed manifest is never accepted as a complete snapshot", async () => {
  const client = createWikiContentClient({ fetch: (async () => new Response(JSON.stringify(compactWikiManifest(manifest)).slice(0, -5))) as unknown as typeof fetch });
  await expect(client.validateManifest(undefined, () => {})).rejects.toThrow();
});

test("stream progress keeps timeout and external cancellation active through the response body", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"siteSlug":');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  try {
    const client = createWikiContentClient({ baseUrl: `http://127.0.0.1:${address.port}`, requestTimeoutMs: 100 });
    const received: number[] = [];
    await expect(client.validateManifest(undefined, n => received.push(n))).rejects.toThrow("timed out");
    expect(received.length).toBeGreaterThan(0);
    const controller = new AbortController();
    const pending = client.fetchPages({ slugs: ["index"], signal: controller.signal, onProgress: () => controller.abort() });
    await expect(pending).rejects.toThrow();
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

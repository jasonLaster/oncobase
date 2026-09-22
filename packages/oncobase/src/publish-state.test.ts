import { expect, test } from "bun:test";
import { readPublishedState, comparePublishedState, type PublishedState } from "./publish-state";
import { HASH_FUNCTION_VERSION, hashDocument, type PublishDocument } from "./walk-vault";

test("targeted state reads bound batches and reject omitted/reordered rows", async () => {
  const counts: number[] = [];
  let omit = false;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    expect(new URL(request.url).pathname).toBe("/api/publish/state");
    const body = await request.json();
    counts.push(body.slugs.length);
    return Response.json({ version: 1, documents: (omit ? body.slugs.slice(1) : body.slugs).map((slug: string) => ({ slug, exists: false })), assets: [] });
  } });
  try {
    const options = { publishUrl: `http://127.0.0.1:${server.port}/api/publish`, token: "fixture", site: "fixture", slugs: Array.from({ length: 33 }, (_, i) => `doc-${i}`), assets: [] };
    expect((await readPublishedState(options)).documents).toHaveLength(33);
    expect(counts).toEqual([16, 16, 1]);
    omit = true;
    await expect(readPublishedState(options)).rejects.toThrow("incomplete");
  } finally { server.stop(true); }
});

test("content verification fails on stale recorded hashes and unavailable raw content; metadata is explicitly weaker", () => {
  const doc: PublishDocument = { slug: "doc", title: "Title", content: "Actual body", tags: [], sensitive: false, sensitiveInclude: [], hash: "" };
  doc.hash = hashDocument(doc);
  const state: PublishedState = { version: 1, documents: [{ slug: doc.slug, exists: true, contentHash: doc.hash,
    observedHash: "corrupt", readerContentConsistent: true, sensitive: false, sensitiveInclude: [], hashFunctionVersion: HASH_FUNCTION_VERSION }], assets: [] };
  expect(comparePublishedState(state, [doc], []).documentMismatches).toHaveLength(1);
  expect(comparePublishedState(state, [doc], [], "metadata").documentMismatches).toHaveLength(0);
  state.documents[0].observedHash = null;
  expect(comparePublishedState(state, [doc], []).documentMismatches).toHaveLength(1);
  state.documents[0].observedHash = doc.hash;
  state.documents[0].sensitiveInclude = ["unexpected"];
  expect(comparePublishedState(state, [doc], [], "metadata").documentMismatches).toHaveLength(1);
});

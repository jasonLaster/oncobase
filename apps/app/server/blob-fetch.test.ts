import { expect, test } from "bun:test";
import { blobHeaderTimeoutMs, fetchBlob } from "./blob-fetch";

const hanging = ((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
  init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
})) as typeof fetch;

test("blob header wait is bounded and configurable", async () => {
  expect(blobHeaderTimeoutMs({})).toBe(10_000);
  expect(blobHeaderTimeoutMs({ WIKI_BLOB_HEADER_TIMEOUT_MS: "5" })).toBe(5);
  await expect(fetchBlob("https://blob.test/a", {}, { headerTimeoutMs: 10, fetchImpl: hanging })).rejects.toThrow("not received");
});

test("caller abort stops the upstream blob read", async () => {
  const controller = new AbortController();
  const pending = fetchBlob("https://blob.test/a", { signal: controller.signal }, { headerTimeoutMs: 0, fetchImpl: hanging });
  controller.abort(new Error("client went away"));
  await expect(pending).rejects.toThrow("client went away");
});

test("the header timeout does not cut off a streaming body", async () => {
  let upstreamSignal: AbortSignal | undefined;
  const streaming = (async (_url: string, init?: RequestInit) => {
    upstreamSignal = init?.signal ?? undefined;
    return new Response("body", { headers: { "Content-Length": "4" } });
  }) as typeof fetch;
  const response = await fetchBlob("https://blob.test/a", { headers: { Range: "bytes=0-3" } }, { headerTimeoutMs: 5, fetchImpl: streaming });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(upstreamSignal?.aborted).toBe(false);
  expect(await response.text()).toBe("body");
});

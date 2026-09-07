import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { acceptsGzip, createEncodedReaderCache } from "./encoded-reader-cache";

test("compressed reader reuse is partitioned by the complete authorized representation", () => {
  const encode = createEncodedReaderCache();
  let renders = 0;
  const render = () => { renders++; return "<p>Unicode: 患者</p>"; };
  const first = encode(["alpha", "/", "content", "policy-one"], render);
  expect(gunzipSync(first).toString()).toBe("<p>Unicode: 患者</p>");
  expect(encode(["alpha", "/", "content", "policy-one"], render)).toBe(first);
  expect(renders).toBe(1);
  encode(["alpha", "/", "content", "policy-two"], render);
  encode(["beta", "/", "content", "policy-one"], render);
  expect(renders).toBe(3);
});

test("gzip negotiation respects explicit rejection", () => {
  expect(acceptsGzip("gzip, br, zstd")).toBe(true);
  expect(acceptsGzip("gzip; q=0, br")).toBe(false);
  expect(acceptsGzip("gzip; q=0.5")).toBe(true);
  expect(acceptsGzip(null)).toBe(false);
  expect(acceptsGzip("not-gzip")).toBe(false);
});

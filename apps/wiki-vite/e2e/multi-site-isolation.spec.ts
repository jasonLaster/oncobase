import { test } from "@playwright/test";

test.describe.skip("P0 multi-site isolation", () => {
  test("invariant 1: same-slug isolation cold and warm", async () => {});
  test("invariant 2: header injection is overwritten", async () => {});
  test("invariant 3: search ranking does not leak across sites", async () => {});
  test("invariant 4: /api/file-tree is empty for non-Diana sites", async () => {});
  test("invariant 5: /api/tools chat tool calls are site-scoped", async () => {});
  test("invariant 6: markdown downloads are site-scoped", async () => {});
  test("invariant 7: /api/share-preview reflects the active site", async () => {});
  test("invariant 8: LiveStore store ids and cached bodies are site-scoped", async () => {});
  test("invariant 9: /api/file returns 404 for paths the active site does not own", async () => {});
  test("invariant 10: AI search and chat citations only reference the active site", async () => {});
});

import { describe, expect, test } from "bun:test";
import type { Metrics } from "../types";
import { readTransferProgress, setManifestReceivedBytes, setPageTransfer } from "./transfer-progress";

describe("transfer progress store", () => {
  test("holds byte progress outside React metrics state", () => {
    setManifestReceivedBytes(2048);
    setPageTransfer({ slug: "a", receivedBytes: 512 });
    expect(readTransferProgress()).toEqual({ manifestReceivedBytes: 2048, pageTransfer: { slug: "a", receivedBytes: 512 } });
    setPageTransfer(null);
    expect(readTransferProgress().pageTransfer).toBeNull();
  });

  test("progress is no longer part of the root metrics that WikiPage, Sidebar and MobileNav receive", () => {
    // @ts-expect-error byte progress moved to the transfer-progress store
    const manifest: Metrics["manifestReceivedBytes"] = 0;
    // @ts-expect-error byte progress moved to the transfer-progress store
    const page: Metrics["pageTransfer"] = null;
    expect([manifest, page]).toEqual([0, null]);
  });

  test("WikiPage is memoized so unrelated root re-renders skip the article", async () => {
    const { WikiPage } = await import("../pages/WikiPage");
    expect((WikiPage as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });
});

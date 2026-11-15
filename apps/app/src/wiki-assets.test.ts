import { expect, test } from "bun:test";
import { assetHashesByPath, assetHref, versionedFileUrl } from "./wiki-assets";

const hashes = assetHashesByPath([
  { path: "wiki/images/scan.png", contentHash: "h-scan" },
  { path: "wiki/paper.pdf", contentHash: "h-pdf" },
  { path: "wiki/unknown.png", contentHash: null },
]);

test("file URLs carry v when the manifest knows the asset hash", () => {
  expect(versionedFileUrl("/api/file?path=wiki%2Fimages%2Fscan.png", hashes)).toBe("/api/file?path=wiki%2Fimages%2Fscan.png&v=h-scan");
  expect(versionedFileUrl("/api/file?path=wiki%2Fpaper.pdf#page=3", hashes)).toBe("/api/file?path=wiki%2Fpaper.pdf&v=h-pdf#page=3");
  expect(versionedFileUrl("/api/education/api/file?path=wiki%2Fpaper.pdf", hashes)).toBe("/api/education/api/file?path=wiki%2Fpaper.pdf&v=h-pdf");
});

test("unknown assets, other URLs and already versioned URLs are unchanged", () => {
  expect(versionedFileUrl("/api/file?path=wiki%2Funknown.png", hashes)).toBe("/api/file?path=wiki%2Funknown.png");
  expect(versionedFileUrl("/wiki/page", hashes)).toBe("/wiki/page");
  expect(versionedFileUrl("https://example.com/x.png", hashes)).toBe("https://example.com/x.png");
  expect(versionedFileUrl("/api/file?path=wiki%2Fpaper.pdf&v=other", hashes)).toBe("/api/file?path=wiki%2Fpaper.pdf&v=other");
  expect(versionedFileUrl(undefined, hashes)).toBeUndefined();
});

test("related-asset links are versioned too", () => {
  expect(assetHref("wiki/paper.pdf", "h-pdf")).toBe("/api/file?path=wiki%2Fpaper.pdf&v=h-pdf");
  expect(assetHref("wiki/paper.pdf")).toBe("/api/file?path=wiki%2Fpaper.pdf");
});

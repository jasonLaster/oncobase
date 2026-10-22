import { expect, test } from "bun:test";
import { backendReleases } from "./local-stack-releases";
type MetadataFetch = NonNullable<Parameters<typeof backendReleases>[1]>;

test("release metadata uses the existing CI token only at the official API", async () => {
  const releases = [{ tag_name: "precompiled-fixture", assets: [{
    name: "convex-local-backend-aarch64-apple-darwin.zip",
    browser_download_url: "https://github.com/get-convex/convex-backend/releases/download/fixture/backend.zip",
  }] }];
  const fetchMetadata: MetadataFetch = async (url, init) => {
    expect(url).toBe("https://api.github.com/repos/get-convex/convex-backend/releases?per_page=20");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer read-only-fixture-token");
    return Response.json(releases);
  };
  expect(await backendReleases("read-only-fixture-token", fetchMetadata)).toEqual(releases);
});

test("HTTP errors fail before indexing the response or exposing its body", async () => {
  const response = Response.json({ message: "private diagnostic fixture" }, { status: 403 });
  const fetchMetadata: MetadataFetch = async () => response;
  await expect(backendReleases("", fetchMetadata)).rejects.toThrow(
    "Convex backend release metadata request failed (HTTP 403)",
  );
  expect(response.bodyUsed).toBe(false);
});

test("local unauthenticated metadata reads remain supported and malformed payloads fail clearly", async () => {
  const fetchMetadata: MetadataFetch = async (_url, init) => {
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    return Response.json({ message: "Unexpected API payload" });
  };
  await expect(backendReleases("", fetchMetadata)).rejects.toThrow("not a release list");
});

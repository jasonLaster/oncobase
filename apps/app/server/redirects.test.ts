import { expect, test } from "bun:test";
import { legacyRedirectResponse } from "./redirects";

test("repository PDF URLs preserve Unicode, spaces and uppercase extensions through the authorized file API", () => {
  const response = legacyRedirectResponse(new Request("https://wiki.test/sources/Case%20report%20caf%C3%A9.PDF?download=1"));
  expect(response?.status).toBe(302);
  const target = new URL(response!.headers.get("location")!);
  expect(target.pathname).toBe("/api/file");
  expect(target.searchParams.get("path")).toBe("sources/Case report café.PDF");
  expect(target.searchParams.get("download")).toBe("1");
  expect(legacyRedirectResponse(new Request("https://wiki.test/api/file?path=source.pdf"))).toBeNull();
});

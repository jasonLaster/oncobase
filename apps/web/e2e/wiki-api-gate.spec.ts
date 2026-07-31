import {
  expect,
  request as playwrightRequest,
  test,
} from "@playwright/test";

test("keeps raw wiki content APIs behind the site password gate", async ({
  baseURL,
}) => {
  const anonymous = await playwrightRequest.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
  });

  try {
    const session = await anonymous.get("/api/wiki/session");
    expect(session.ok()).toBe(true);

    for (const path of [
      "/api/wiki/manifest",
      "/api/wiki/pages?slugs=index",
      "/api/file?path=sources%2Fexample.pdf",
    ]) {
      const response = await anonymous.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(401);
      expect(response.headers()["cache-control"], path).toBe(
        "private, no-store",
      );
      expect(response.headers().vary, path).toContain("Cookie");
      expect(await response.json()).toEqual({
        error: "Password gate authentication required",
      });
    }
  } finally {
    await anonymous.dispose();
  }
});

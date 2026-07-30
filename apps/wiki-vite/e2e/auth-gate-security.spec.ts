import {
  expect,
  request as playwrightRequest,
  test,
} from "@playwright/test";

const runsAgainstProductionServer = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test("rejects a forged legacy gate cookie with private redirect headers", async ({
  baseURL,
}) => {
  test.skip(
    !runsAgainstProductionServer,
    "The app-shell password gate is owned by the standalone/Vercel server.",
  );
  const origin = new URL(baseURL!).origin;
  const request = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Cookie: "authed=true" },
    storageState: { cookies: [], origins: [] },
  });

  try {
    const response = await request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(new URL(response.headers().location, origin).pathname).toBe(
      "/login",
    );
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers().vary).toContain("Cookie");
    expect(response.headers().vary).toContain("Host");
  } finally {
    await request.dispose();
  }
});

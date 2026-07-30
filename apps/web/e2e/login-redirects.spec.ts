import {
  expect,
  request as playwrightRequest,
  test,
  type Browser,
} from "@playwright/test";

const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

function previewBypassHeaders(): Record<string, string> {
  return previewBypassSecret
    ? { "x-vercel-protection-bypass": previewBypassSecret }
    : {};
}

async function submitPassword(
  browser: Browser,
  baseURL: string,
  redirect: string,
  rawHash = "",
) {
  const context = await browser.newContext({
    extraHTTPHeaders: previewBypassHeaders(),
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto(
    `${baseURL}/login?redirect=${encodeURIComponent(redirect)}${rawHash}`,
  );
  await page.getByPlaceholder("Password").fill("diana");
  await page.getByRole("button", { name: "Enter" }).click();
  return { context, page };
}

test.describe("password login redirects", () => {
  test("LoginForm preserves local hashes and rejects external targets", async ({
    baseURL,
    browser,
  }) => {
    const origin = new URL(baseURL!).origin;

    const local = await submitPassword(
      browser,
      origin,
      "/about/Terminology",
      "#brca",
    );
    await expect(local.page).toHaveURL(`${origin}/about/Terminology#brca`);
    await local.context.close();

    for (const redirect of [
      "https://evil.example/phish",
      "//evil.example/phish",
    ]) {
      const unsafe = await submitPassword(browser, origin, redirect);
      await expect(unsafe.page).toHaveURL(`${origin}/`);
      await unsafe.context.close();
    }
  });

  test("login API rejects password query parameters and preserves safe local targets", async ({
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });

    try {
      for (const [redirect, expected] of [
        ["/about/About?view=compact", "/about/About?view=compact"],
        ["https://evil.example/phish", "/"],
        ["//evil.example/phish", "/"],
      ]) {
        const response = await request.get(
          `/api/login?token=diana&redirect=${encodeURIComponent(redirect)}`,
          { maxRedirects: 0 },
        );
        expect(response.status()).toBe(307);
        expect(response.headers()["set-cookie"]).toBeUndefined();
        expect(response.headers()["cache-control"]).toBe("private, no-store");
        expect(response.headers().vary).toContain("Cookie");
        expect(new URL(response.headers().location, origin).toString()).toBe(
          new URL(
            `/login?redirect=${encodeURIComponent(expected)}`,
            origin,
          ).toString(),
        );
        expect(response.headers().location).not.toContain("token");
      }
    } finally {
      await request.dispose();
    }
  });

  test("legacy page token parameters are stripped without creating a session", async ({
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });

    try {
      const response = await request.get(
        "/about/About?token=diana&view=compact",
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(307);
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(new URL(response.headers().location, origin).toString()).toBe(
        `${origin}/about/About?view=compact`,
      );
    } finally {
      await request.dispose();
    }
  });

  test("authenticated login route accepts local paths and rejects external targets", async ({
    baseURL,
    browser,
  }) => {
    const origin = new URL(baseURL!).origin;
    const authenticated = await submitPassword(browser, origin, "/");
    await authenticated.page.waitForURL(`${origin}/`);
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: await authenticated.context.storageState(),
    });
    try {
      for (const [redirect, expected] of [
        ["/about/About?view=compact", "/about/About?view=compact"],
        ["https://evil.example/phish", "/"],
        ["//evil.example/phish", "/"],
      ]) {
        const response = await request.get(
          `/login?redirect=${encodeURIComponent(redirect)}`,
          { maxRedirects: 0 },
        );
        expect(response.status()).toBe(307);
        expect(response.headers()["cache-control"]).toBe("private, no-store");
        expect(response.headers().vary).toContain("Cookie");
        expect(response.headers().vary).toContain("Host");
        expect(new URL(response.headers().location, origin).toString()).toBe(
          new URL(expected, origin).toString(),
        );
      }
    } finally {
      await request.dispose();
      await authenticated.context.close();
    }
  });

  test("rejects a forged legacy gate cookie with private redirect headers", async ({
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: {
        ...previewBypassHeaders(),
        Cookie: "authed=true",
      },
      storageState: { cookies: [], origins: [] },
    });

    try {
      const response = await request.get("/", { maxRedirects: 0 });
      expect(response.status()).toBe(307);
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
});

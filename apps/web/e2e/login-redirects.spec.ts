import {
  request as playwrightRequest,
  type Browser,
} from "@playwright/test";
import { expect, test } from "./fixtures";

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

test.describe("@smoke @cross-browser password login redirects", () => {
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

  test("page password tokens create a signed session and preserve other query parameters", async ({
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });

    try {
      const target =
        "/tools/dicom-viewer?id=diagnostic-2026-07-27-ct-chest";
      const response = await request.get(`${target}&token=diana`, {
        maxRedirects: 0,
      });
      expect(response.status()).toBe(307);
      expect(response.headers()["set-cookie"]).toMatch(/^authed=[^;]+;/);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(new URL(response.headers().location, origin).toString()).toBe(
        `${origin}${target}`,
      );

      const authenticated = await request.get(target, {
        maxRedirects: 0,
      });
      expect(authenticated.status()).toBe(200);
    } finally {
      await request.dispose();
    }
  });

  test("invalid page password tokens are stripped without creating a session", async ({
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
        "/about/About?token=incorrect&view=compact",
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(307);
      expect(response.headers()["set-cookie"]).toBeUndefined();
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(new URL(response.headers().location, origin).toString()).toBe(
        `${origin}/about/About?view=compact`,
      );

      const unauthenticated = await request.get("/about/About?view=compact", {
        maxRedirects: 0,
      });
      expect(unauthenticated.status()).toBe(307);
      expect(
        new URL(unauthenticated.headers().location, origin).pathname,
      ).toBe("/login");
    } finally {
      await request.dispose();
    }
  });

  test("password gate preserves query parameters in the post-login target", async ({
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });

    try {
      const target = "/tools/medical-deduction?agi=900000&medical=1000000";
      const response = await request.get(target, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const loginUrl = new URL(response.headers().location, origin);
      expect(loginUrl.pathname).toBe("/login");
      expect(loginUrl.searchParams.get("redirect")).toBe(target);
    } finally {
      await request.dispose();
    }
  });

  test("anonymous readers cannot self-register behind the site password", async ({
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    const request = await playwrightRequest.newContext({
      baseURL: origin,
      extraHTTPHeaders: previewBypassHeaders(),
      storageState: { cookies: [], origins: [] },
    });

    try {
      const response = await request.post("/api/auth/signup", {
        data: {
          email: "anonymous-signup@example.test",
          name: "Anonymous Signup",
          password: "playwright-password",
        },
      });
      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
      expect(response.headers().vary).toContain("Cookie");
      expect(await response.json()).toEqual({
        error: "Password gate access is required to create an account",
      });
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

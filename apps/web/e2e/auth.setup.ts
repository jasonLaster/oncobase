import { mkdir, writeFile } from "node:fs/promises";
import type { APIRequestContext } from "@playwright/test";
import { test as setup } from "@playwright/test";

const AUTH_STATE_PATH = "e2e/.auth/state.json";

const isProd = process.env.TEST_ENV === "prod";
const previewBypassHeaders = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? {
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      "x-vercel-set-bypass-cookie": "true",
      "x-diana-test-auth": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    }
  : undefined;

async function saveDianaPreviewAuthState(
  request: APIRequestContext,
  appBaseURL: string
) {
  const url = new URL(appBaseURL);
  const state = await request.storageState();
  const cookies = state.cookies.filter((cookie) => cookie.name !== "authed");

  cookies.push({
    name: "authed",
    value: "true",
    domain: url.hostname,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "Lax",
  });

  await mkdir("e2e/.auth", { recursive: true });
  await writeFile(AUTH_STATE_PATH, JSON.stringify({ ...state, cookies }, null, 2));
}

setup("authenticate", async ({ request, baseURL }) => {
  const appBaseURL = baseURL ?? "http://localhost:3000";

  if (previewBypassHeaders) {
    const bypassRes = await request.get(appBaseURL, {
      headers: previewBypassHeaders,
    });

    if (bypassRes.status() === 401 || bypassRes.status() === 403) {
      throw new Error(
        `Failed to bypass Vercel preview protection: ${bypassRes.status()} ${bypassRes.statusText()}`
      );
    }

    if (isProd) {
      await saveDianaPreviewAuthState(request, appBaseURL);
      return;
    }
  }

  const res = await request.post(`${appBaseURL}/api/login`, {
    headers: previewBypassHeaders,
    data: { password: "diana" },
  });
  if (!res.ok()) throw new Error("Login failed");

  // Save the cookie state for all tests
  await request.storageState({ path: AUTH_STATE_PATH });
});

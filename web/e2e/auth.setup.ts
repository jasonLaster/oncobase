import { test as setup } from "@playwright/test";

const previewBypassHeaders = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? {
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      "x-vercel-set-bypass-cookie": "true",
    }
  : undefined;

setup("authenticate", async ({ request, baseURL }) => {
  const appBaseURL = baseURL ?? "http://localhost:3000";

  if (previewBypassHeaders) {
    const bypassRes = await request.get(appBaseURL, {
      headers: previewBypassHeaders,
    });

    if (!bypassRes.ok()) {
      throw new Error(
        `Failed to bypass Vercel preview protection: ${bypassRes.status()} ${bypassRes.statusText()}`
      );
    }
  }

  const res = await request.post(`${appBaseURL}/api/login`, {
    headers: previewBypassHeaders,
    data: { password: "diana" },
  });
  if (!res.ok()) throw new Error("Login failed");

  // Save the cookie state for all tests
  await request.storageState({ path: "e2e/.auth/state.json" });
});

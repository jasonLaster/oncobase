import { test as setup } from "@playwright/test";

setup("authenticate", async ({ request, baseURL }) => {
  const res = await request.post(`${baseURL}/api/login`, {
    data: { password: "diana" },
  });
  if (!res.ok()) throw new Error("Login failed");

  // Save the cookie state for all tests
  await request.storageState({ path: "e2e/.auth/state.json" });
});

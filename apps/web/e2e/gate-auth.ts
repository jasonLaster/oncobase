import type { APIRequestContext } from "@playwright/test";

export async function passwordGateCookie(request: APIRequestContext) {
  const response = await request.post("/api/login", {
    data: { password: "diana" },
  });
  if (!response.ok()) {
    throw new Error(`Password gate login failed: ${response.status()}`);
  }
  const cookie = response.headers()["set-cookie"]?.split(";")[0];
  if (!cookie?.startsWith("authed=v1.")) {
    throw new Error("Password gate login did not return a signed session");
  }
  return cookie;
}

import type { APIRequestContext } from "@playwright/test";

export async function passwordGateCookie(request: APIRequestContext) {
  const password = process.env.PLAYWRIGHT_BASE_URL
    ? process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD
    : "diana";
  if (!password) {
    throw new Error(
      "Password gate login requires WIKI_VITE_PREVIEW_LOGIN_PASSWORD",
    );
  }
  const response = await request.post("/api/login", {
    data: { password },
  });
  if (!response.ok()) {
    throw new Error(`Password gate login failed: ${response.status()}`);
  }
  const cookie = response.headers()["set-cookie"]?.split(";")[0];
  if (!cookie?.startsWith("authed=") || cookie.length <= "authed=".length) {
    throw new Error("Password gate login did not return a signed session");
  }
  return cookie;
}

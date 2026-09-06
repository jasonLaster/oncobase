import type { APIRequestContext, Page } from "@playwright/test";

function gatePassword() {
  return process.env.PLAYWRIGHT_BASE_URL
    ? process.env.WIKI_VITE_PREVIEW_LOGIN_PASSWORD
    : "diana";
}

/**
 * Clears the site password gate for a browser context. Specs that talk to the
 * live backend (rather than `installWikiApiMocks`) need this or the gate
 * redirects every navigation to /login. Preview runs that rely on the global
 * setup's stored session and have no password configured are left untouched.
 */
export async function ensurePasswordGateSession(page: Page) {
  const password = gatePassword();
  if (!password) return;
  const response = await page.request.post("/api/login", { data: { password } });
  if (!response.ok()) {
    throw new Error(`Password gate login failed: ${response.status()}`);
  }
}

export async function passwordGateCookie(request: APIRequestContext) {
  const password = gatePassword();
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

import { PROD_CONVEX_FALLBACK_URL } from "../src/lib/convex-url";

const TEST_CONVEX_ENV = "PLAYWRIGHT_TEST_CONVEX_URL";
const TEST_LIVEBLOCKS_ENV = "PLAYWRIGHT_TEST_LIVEBLOCKS_SECRET_KEY";

function configured(name: string) {
  return process.env[name]?.trim() || undefined;
}

export function testConvexUrl() {
  const url = configured(TEST_CONVEX_ENV);
  if (url === PROD_CONVEX_FALLBACK_URL) {
    throw new Error(
      `${TEST_CONVEX_ENV} must reference an isolated test deployment, not the production Convex deployment.`,
    );
  }
  return url;
}

export function testLiveblocksSecret() {
  return configured(TEST_LIVEBLOCKS_ENV);
}

export function isolatedTestBackendEnabled() {
  return Boolean(testConvexUrl());
}

export function localPlaywrightServerEnv() {
  const convexUrl = testConvexUrl() ?? "";
  const liveblocksSecret = testLiveblocksSecret() ?? "";

  return {
    ...process.env,
    CONVEX_URL: convexUrl,
    E2E_ALLOW_TEST_MUTATIONS: convexUrl ? "1" : "0",
    LIVEBLOCKS_API_KEY: liveblocksSecret,
    LIVEBLOCKS_SECRET_KEY: liveblocksSecret,
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
    NEXT_PUBLIC_ENABLE_CHAT: convexUrl ? "true" : "false",
    NEXT_PUBLIC_USE_PROD_CONVEX: "0",
  };
}

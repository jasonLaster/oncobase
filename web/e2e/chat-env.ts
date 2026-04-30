const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function isLocalhostUrl(rawUrl: string | undefined) {
  if (!rawUrl) {
    return false;
  }

  try {
    return LOCALHOST_NAMES.has(new URL(rawUrl).hostname);
  } catch {
    return false;
  }
}

export function shouldSkipLocalStreamingChatE2E() {
  if (process.env.TEST_ENV !== "prod" || !isLocalhostUrl(process.env.PROD_URL)) {
    return false;
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return (
    !process.env.AI_GATEWAY_API_KEY ||
    !convexUrl ||
    convexUrl.includes("placeholder.convex.cloud")
  );
}

export const localStreamingChatSkipReason =
  "Streaming chat E2E requires AI_GATEWAY_API_KEY and a real Convex URL for localhost prod runs.";

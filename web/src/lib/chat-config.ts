export const chatConfigured =
  process.env.NEXT_PUBLIC_ENABLE_CHAT === "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

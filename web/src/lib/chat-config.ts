import { resolvePublicConvexUrl } from "@/lib/convex-url";

export const chatConfigured =
  process.env.NEXT_PUBLIC_ENABLE_CHAT === "true" &&
  Boolean(resolvePublicConvexUrl());

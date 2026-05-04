"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { resolvePublicConvexUrl } from "@/lib/convex-url";

let convexClient: ConvexReactClient | null = null;
const FALLBACK_CONVEX_URL = "https://disabled.invalid";

function getConvexUrl(): string {
  return resolvePublicConvexUrl() || FALLBACK_CONVEX_URL;
}

function getConvexClient(): ConvexReactClient {
  const convexUrl = getConvexUrl();

  if (!convexClient || convexClient.url !== convexUrl) {
    // Keep a provider mounted even when Convex is disabled so feature-gated
    // chat routes don't crash while parent layouts prerender.
    convexClient = new ConvexReactClient(convexUrl);
  }

  return convexClient;
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProvider client={getConvexClient()}>{children}</ConvexProvider>;
}

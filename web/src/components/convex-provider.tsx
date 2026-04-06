"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ReactNode, useRef } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<ConvexReactClient | null>(null);

  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return <>{children}</>;
  }

  if (!clientRef.current) {
    clientRef.current = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL);
  }

  return <ConvexProvider client={clientRef.current}>{children}</ConvexProvider>;
}

"use client";

import { RoomProvider } from "@liveblocks/react/suspense";
import type { ReactNode } from "react";
import {
  LiveblocksProviderShell,
  type LiveblocksProviderShellProps,
} from "./provider.tsx";

export function LiveblocksRoom({
  roomId,
  provider,
  fallback,
  children,
}: {
  roomId: string;
  provider?: Omit<LiveblocksProviderShellProps, "children" | "fallback">;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <LiveblocksProviderShell {...provider} fallback={fallback}>
      <RoomProvider id={roomId}>{children}</RoomProvider>
    </LiveblocksProviderShell>
  );
}

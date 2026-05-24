"use client";

import { RoomProvider } from "@liveblocks/react/suspense";
import type { ReactNode } from "react";
import { LiveblocksProviderShell } from "@/components/liveblocks-provider-shell";

export function LiveblocksRoom({
  roomId,
  fallback,
  children,
}: {
  roomId: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <LiveblocksProviderShell fallback={fallback}>
      <RoomProvider id={roomId}>{children}</RoomProvider>
    </LiveblocksProviderShell>
  );
}

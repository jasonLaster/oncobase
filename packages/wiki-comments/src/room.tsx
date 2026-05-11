"use client";

import { RoomProvider } from "@liveblocks/react/suspense";
import type { ReactNode } from "react";
import { LiveblocksProviderShell } from "./provider";

export function LiveblocksRoom({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  return (
    <LiveblocksProviderShell>
      <RoomProvider id={roomId}>{children}</RoomProvider>
    </LiveblocksProviderShell>
  );
}

import { Liveblocks } from "@liveblocks/node";
import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/session-user";
import {
  liveblocksDisabledResponse,
  resolveLiveblocksConfig,
} from "@/lib/liveblocks-site";

export async function POST(request: Request) {
  const config = await resolveLiveblocksConfig(request);
  if (!config.ok) {
    return liveblocksDisabledResponse(config);
  }

  const { roomId, threadId } = (await request.json()) as {
    roomId?: string;
    threadId?: string;
  };

  if (!roomId || !threadId) {
    return NextResponse.json(
      { error: "roomId and threadId are required" },
      { status: 400 }
    );
  }

  const sessionUser = await getSessionUserFromRequest(request);
  if (!sessionUser) {
    return NextResponse.json(
      { error: "Sign in to manage comments" },
      { status: 401 }
    );
  }

  try {
    const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
    await liveblocks.deleteThread({ roomId, threadId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[liveblocks-delete-thread] Error:", err);
    return NextResponse.json(
      { error: "Failed to delete thread" },
      { status: 500 }
    );
  }
}

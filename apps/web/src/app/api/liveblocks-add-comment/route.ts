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

  const { roomId, threadId, body: commentText } = (await request.json()) as {
    roomId?: string;
    threadId?: string;
    body?: string;
  };

  if (!roomId || !threadId || !commentText?.trim()) {
    return NextResponse.json(
      { error: "roomId, threadId, and body are required" },
      { status: 400 }
    );
  }

  // Resolve the current user
  const sessionUser = await getSessionUserFromRequest(request);
  if (!sessionUser) {
    return NextResponse.json(
      { error: "Sign in to comment" },
      { status: 401 }
    );
  }

  const userId = sessionUser._id;

  try {
    const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
    const comment = await liveblocks.createComment({
      roomId,
      threadId,
      data: {
        userId,
        body: {
          version: 1,
          content: [
            {
              type: "paragraph",
              children: [{ text: commentText.trim() }],
            },
          ],
        },
      },
    });
    return NextResponse.json({ ok: true, comment });
  } catch (err) {
    console.error("[liveblocks-add-comment] Error:", err);
    return NextResponse.json(
      { error: "Failed to add comment" },
      { status: 500 }
    );
  }
}

import { Liveblocks } from "@liveblocks/node";
import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { LIVEBLOCKS_GUEST_COOKIE, parseGuestUser } from "@/lib/guest-user";

const liveblocksSecret =
  process.env.LIVEBLOCKS_SECRET_KEY ?? process.env.LIVEBLOCKS_API_KEY;

export async function POST(request: Request) {
  if (!liveblocksSecret) {
    return NextResponse.json(
      { error: "Liveblocks secret key not configured" },
      { status: 503 }
    );
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
  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  const guestUser = parseGuestUser(guestCookie);

  const userId = sessionUser?._id ?? guestUser?.id ?? `guest:${roomId}`;

  try {
    const liveblocks = new Liveblocks({ secret: liveblocksSecret });
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

import { Liveblocks } from "@liveblocks/node";
import { NextResponse } from "next/server";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { LIVEBLOCKS_GUEST_COOKIE, parseGuestUser } from "@/lib/guest-user";
import { persistLiveblocksGuestName } from "@/lib/liveblocks-user-resolution";
import { siteDataFromRequest } from "@/lib/site-data";
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
  const siteData = siteDataFromRequest(request);
  if (!sessionUser && (await isSensitiveRoom(roomId, siteData))) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  const guestUser = parseGuestUser(guestCookie);
  if (guestUser) {
    await persistLiveblocksGuestName(guestUser, siteData).catch(() => {});
  }

  const userId = sessionUser?._id ?? guestUser?.id ?? `guest:${roomId}`;

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

async function isSensitiveRoom(roomId: string, siteData: ReturnType<typeof siteDataFromRequest>) {
  if (!roomId.startsWith("markdown:")) return false;
  const doc = await siteData.documents.getBySlug({
    slug: roomId.slice("markdown:".length),
    includeSensitive: true,
  });
  return doc?.sensitive === true;
}

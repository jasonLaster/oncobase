import { NextResponse } from "next/server";
import { Liveblocks } from "@liveblocks/node";
import { LIVEBLOCKS_GUEST_COOKIE, parseGuestUser } from "@/lib/guest-user";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { persistLiveblocksGuestName } from "@/lib/liveblocks-user-resolution";

const liveblocksSecret =
  process.env.LIVEBLOCKS_SECRET_KEY ?? process.env.LIVEBLOCKS_API_KEY;

const liveblocks = liveblocksSecret
  ? new Liveblocks({
      secret: liveblocksSecret,
    })
  : null;

export async function GET() {
  return NextResponse.json({ configured: Boolean(liveblocks) });
}

export async function POST(request: Request) {
  if (!liveblocks) {
    return NextResponse.json(
      {
        error: "LIVEBLOCKS_SECRET_KEY is not configured",
      },
      { status: 503 }
    );
  }

  const { room } = (await request.json()) as { room?: string };
  if (!room || typeof room !== "string") {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }

  const sessionUser = await getSessionUserFromRequest(request);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  const guestUser = parseGuestUser(guestCookie);
  if (guestUser) {
    await persistLiveblocksGuestName(guestUser).catch(() => {});
  }

  const userId = sessionUser?._id ?? guestUser?.id ?? `guest:${room}`;
  const userInfo = {
    name: sessionUser?.name || sessionUser?.email || guestUser?.name || "Guest",
    email: sessionUser?.email,
  };

  const session = liveblocks.prepareSession(userId, { userInfo });
  session.allow(room, session.FULL_ACCESS);
  const { body, status } = await session.authorize();

  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

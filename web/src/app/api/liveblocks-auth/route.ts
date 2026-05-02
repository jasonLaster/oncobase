import { NextResponse } from "next/server";
import { Liveblocks } from "@liveblocks/node";
import { LIVEBLOCKS_GUEST_COOKIE, parseGuestUser } from "@/lib/guest-user";
import { getSessionUserFromRequest } from "@/lib/session-user";
import { persistLiveblocksGuestName } from "@/lib/liveblocks-user-resolution";
import { siteDataFromRequest } from "@/lib/site-data";
import {
  liveblocksDisabledResponse,
  resolveLiveblocksConfig,
} from "@/lib/liveblocks-site";

export async function GET(request: Request) {
  const config = await resolveLiveblocksConfig(request);
  return NextResponse.json({ configured: config.ok });
}

export async function POST(request: Request) {
  const config = await resolveLiveblocksConfig(request);
  if (!config.ok) {
    return liveblocksDisabledResponse(config);
  }

  const { room } = (await request.json()) as { room?: string };
  if (!room || typeof room !== "string") {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }

  // Use a per-site Liveblocks client so the auth token is signed by the
  // workspace this site owns. With per-site workspaces, room IDs cannot
  // leak across sites — they live in different Liveblocks workspaces.
  const liveblocks = new Liveblocks({ secret: config.creds.secretKey });

  const sessionUser = await getSessionUserFromRequest(request);
  const siteData = siteDataFromRequest(request);
  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  const guestUser = parseGuestUser(guestCookie);
  if (guestUser) {
    await persistLiveblocksGuestName(guestUser, siteData).catch(() => {});
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

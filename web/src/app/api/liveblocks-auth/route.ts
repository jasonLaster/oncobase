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
  return NextResponse.json({
    configured: config.ok,
    siteSlug: config.ok ? config.creds.siteSlug : config.siteSlug,
    reason: config.ok ? null : config.reason,
  });
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
  if (!sessionUser && (await isSensitiveRoom(room, siteData))) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const guestUser = sessionUser ? null : parseGuestUserFromRequest(request);
  if (guestUser) {
    await persistLiveblocksGuestName(guestUser, siteData).catch(() => {});
  }

  const userId = sessionUser?._id ?? guestUser?.id ?? `guest:${room}`;
  const userInfo = {
    name: sessionUser?.name || sessionUser?.email || guestUser?.name || "Guest",
    email: sessionUser?.email,
  };

  const session = liveblocks.prepareSession(userId, { userInfo });
  session.allow(room, sessionUser ? session.FULL_ACCESS : session.READ_ACCESS);
  const { body, status } = await session.authorize();

  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function parseGuestUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  return parseGuestUser(guestCookie);
}

async function isSensitiveRoom(roomId: string, siteData: ReturnType<typeof siteDataFromRequest>) {
  if (!roomId.startsWith("markdown:")) return false;
  const doc = await siteData.documents.getBySlug({
    slug: roomId.slice("markdown:".length),
    includeSensitive: true,
  });
  return doc?.sensitive === true;
}

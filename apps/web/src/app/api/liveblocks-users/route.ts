import { NextResponse } from "next/server";
import { resolveLiveblocksUsers } from "@/lib/liveblocks-user-resolution";
import { siteDataFromRequest } from "@/lib/site-data";

const MAX_USER_IDS = 100;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    userIds?: unknown;
  } | null;

  if (!Array.isArray(body?.userIds)) {
    return NextResponse.json(
      { error: "userIds array is required" },
      { status: 400 }
    );
  }

  const userIds = body.userIds.filter(
    (userId): userId is string => typeof userId === "string"
  );

  if (userIds.length !== body.userIds.length) {
    return NextResponse.json(
      { error: "userIds must only contain strings" },
      { status: 400 }
    );
  }

  if (userIds.length > MAX_USER_IDS) {
    return NextResponse.json(
      { error: `userIds is limited to ${MAX_USER_IDS} entries` },
      { status: 400 }
    );
  }

  const users = await resolveLiveblocksUsers(userIds, siteDataFromRequest(request));
  return NextResponse.json({ users });
}

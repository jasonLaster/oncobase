import { NextResponse } from "next/server";
import { persistLiveblocksGuestName } from "@/lib/liveblocks-user-resolution";
import { siteDataFromRequest } from "@/lib/site-data";

export async function POST(request: Request) {
  const { guestId, name } = (await request.json()) as {
    guestId?: string;
    name?: string;
  };

  if (!guestId || !name) {
    return NextResponse.json({ error: "guestId and name required" }, { status: 400 });
  }

  try {
    await persistLiveblocksGuestName(
      { id: guestId, name },
      siteDataFromRequest(request),
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save guest name" }, { status: 500 });
  }
}

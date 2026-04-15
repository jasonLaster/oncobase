import { NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";

export async function POST(request: Request) {
  const { guestId, name } = (await request.json()) as {
    guestId?: string;
    name?: string;
  };

  if (!guestId || !name) {
    return NextResponse.json({ error: "guestId and name required" }, { status: 400 });
  }

  try {
    const convex = getConvexServerClient();
    await convex.mutation(api.guestNames.upsert, { guestId, name });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to save guest name" }, { status: 500 });
  }
}

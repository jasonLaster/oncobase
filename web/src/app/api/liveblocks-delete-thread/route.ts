import { Liveblocks } from "@liveblocks/node";
import { NextResponse } from "next/server";

const liveblocksSecret =
  process.env.LIVEBLOCKS_SECRET_KEY ?? process.env.LIVEBLOCKS_API_KEY;

export async function POST(request: Request) {
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

  if (!liveblocksSecret) {
    return NextResponse.json(
      { error: "Liveblocks secret key not configured" },
      { status: 503 }
    );
  }

  try {
    const liveblocks = new Liveblocks({ secret: liveblocksSecret });
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

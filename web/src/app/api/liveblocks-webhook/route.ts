import { WebhookHandler } from "@liveblocks/node";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { DEFAULT_SITE_SLUG } from "@/lib/site";

const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;

// Multi-site TODO: webhook events come server-to-server from
// Liveblocks itself, not from a tenant request. The active site has
// to be derived from the Liveblocks workspace (one per site, per
// the Phase 6 plan). Until per-site workspace provisioning is
// wired up (`wiki:site:create` calling the Liveblocks management
// API), every webhook event defaults to Diana — which is correct
// for the migration window. Once workspaces per site exist, look
// up the site by `event.data.workspaceId` (or whatever Liveblocks
// surfaces) and pass that slug to the Convex mutations.

export async function POST(req: NextRequest) {
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 503 }
    );
  }

  const webhookHandler = new WebhookHandler(webhookSecret);
  const rawBody = await req.text();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;

  try {
    event = webhookHandler.verifyRequest({
      headers: Object.fromEntries(req.headers.entries()),
      rawBody,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const convex = getConvexServerClient();

  try {
    switch (event.type) {
      case "threadCreated": {
        const { roomId } = event.data;
        await convex.mutation(api.commentRooms.incrementRoom, {
          roomId,
          siteSlug: DEFAULT_SITE_SLUG,
        });
        clearThreadsCache();
        break;
      }
      case "threadDeleted": {
        const { roomId } = event.data;
        await convex.mutation(api.commentRooms.decrementRoom, {
          roomId,
          siteSlug: DEFAULT_SITE_SLUG,
        });
        clearThreadsCache();
        break;
      }
      // commentCreated/commentDeleted don't change which rooms are active,
      // but we should invalidate the cache so new comments appear quickly
      case "commentCreated":
      case "commentEdited":
      case "commentDeleted":
      case "threadMarkedAsResolved":
      case "threadMarkedAsUnresolved": {
        clearThreadsCache();
        break;
      }
    }
  } catch (err) {
    console.error("[liveblocks-webhook] Error processing event:", err);
    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

// ── Cache invalidation ─────────────────────────────────────
// Import the cache-clearing function from the threads route.
// Since module-level state is shared within the same process,
// we expose a setter from the threads route module.

async function clearThreadsCache() {
  try {
    // Dynamic import to avoid circular deps — the cache lives in the threads route
    const threadsModule = await import("../liveblocks-threads/route");
    if (typeof threadsModule.invalidateCache === "function") {
      threadsModule.invalidateCache();
    }
  } catch {
    // If module isn't loaded yet, cache is empty anyway
  }
}

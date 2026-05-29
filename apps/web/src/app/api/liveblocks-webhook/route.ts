import { WebhookHandler } from "@liveblocks/node";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@convex/_generated/api";
import { getConvexServerClient } from "@/lib/convex-server";
import { DEFAULT_SITE_SLUG } from "@/lib/site";
import { siteDataFromSlug } from "@/lib/site-data";

const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;

// Multi-site webhook routing: Liveblocks sends events server-to-server,
// not from a tenant request, so the active site has to be derived from
// the event payload itself. Each Liveblocks workspace belongs to one
// site (per plans/multi-tenant-wiki/MVP.md "Per-site Liveblocks
// workspaces"). We look up the site by `event.data.projectId` against
// `sites.liveblocksWorkspaceId`. Diana's existing webhook (no per-site
// workspace yet) falls back to DEFAULT_SITE_SLUG so existing comments
// continue to flow during the migration window.

async function resolveSiteFromEvent(event: {
  data?: { projectId?: string };
}): Promise<string> {
  const workspaceId = event.data?.projectId;
  if (!workspaceId) return DEFAULT_SITE_SLUG;
  try {
    const site = await getConvexServerClient().query(
      api.sites.getByLiveblocksWorkspace,
      { workspaceId },
    );
    return site?.slug ?? DEFAULT_SITE_SLUG;
  } catch {
    return DEFAULT_SITE_SLUG;
  }
}

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

  const siteSlug = await resolveSiteFromEvent(event);
  const siteData = siteDataFromSlug(siteSlug);

  try {
    switch (event.type) {
      case "threadCreated": {
        const { roomId } = event.data;
        await siteData.commentRooms.incrementRoom({
          roomId,
        });
        clearThreadsCache(siteSlug);
        break;
      }
      case "threadDeleted": {
        const { roomId } = event.data;
        await siteData.commentRooms.decrementRoom({
          roomId,
        });
        clearThreadsCache(siteSlug);
        break;
      }
      // commentCreated/commentDeleted don't change which rooms are active,
      // but we should invalidate the cache so new comments appear quickly
      case "commentCreated":
      case "commentEdited":
      case "commentDeleted":
      case "threadMarkedAsResolved":
      case "threadMarkedAsUnresolved": {
        clearThreadsCache(siteSlug);
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

async function clearThreadsCache(siteSlug: string) {
  try {
    // Dynamic import to avoid circular deps — the cache lives in the threads route
    const threadsModule = await import("../liveblocks-threads/route");
    if (typeof threadsModule.invalidateCache === "function") {
      threadsModule.invalidateCache(siteSlug);
    }
  } catch {
    // If module isn't loaded yet, cache is empty anyway
  }
}

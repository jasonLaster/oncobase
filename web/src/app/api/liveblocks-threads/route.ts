import { Liveblocks } from "@liveblocks/node";
import { connection, NextResponse } from "next/server";
import { resolveLiveblocksUsers } from "@/lib/liveblocks-user-resolution";
import { siteDataFromRequest, type SiteData } from "@/lib/site-data";
import { getSessionUserFromRequest } from "@/lib/session-user";
import {
  liveblocksDisabledResponse,
  resolveLiveblocksConfig,
} from "@/lib/liveblocks-site";

// ── Cache layer ────────────────────────────────────────────
// Response cache (30s TTL). Invalidated early by webhooks.

type CachedResponse = {
  body: object;
  timestamp: number;
};

const RESPONSE_TTL_MS = 30_000; // 30s
const responseCache = new Map<string, CachedResponse>();

/** Called by the webhook route to bust the cache when comments change. */
export function invalidateCache(siteSlug?: string) {
  if (siteSlug) {
    responseCache.delete(`${siteSlug}:public`);
    responseCache.delete(`${siteSlug}:private`);
  } else {
    responseCache.clear();
  }
}

export async function GET(request: Request) {
  await connection();

  const config = await resolveLiveblocksConfig(request);
  if (!config.ok) {
    return liveblocksDisabledResponse(config);
  }

  const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
  const siteData = siteDataFromRequest(request);
  const siteSlug = siteData.siteSlug;
  const includeSensitive = Boolean(await getSessionUserFromRequest(request));
  const cacheKey = `${siteSlug}:${includeSensitive ? "private" : "public"}`;
  const cached = responseCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < RESPONSE_TTL_MS) {
    return NextResponse.json(cached.body);
  }

  const t0 = Date.now();
  const timing: Record<string, number> = {};

  try {
    // ── 1. Get active rooms from Convex ─────────────────────
    // The commentRooms table is kept in sync by the webhook.
    // Falls back to a full Liveblocks room scan if Convex has no data yet.
    let roomsToQuery: string[];
    let mode: string;

    // Try the Convex fast path (commentRooms table populated by webhook).
    // Falls back to full Liveblocks scan if Convex lookup fails (e.g. function not deployed).
    let activeRooms: string[] = [];
    try {
      activeRooms = await siteData.commentRooms.listActive();
    } catch {
      // commentRooms function may not be deployed yet — fall through to full scan
    }
    timing.convexLookup = Date.now() - t0;

    if (activeRooms.length > 0) {
      roomsToQuery = activeRooms;
      mode = "convex";
    } else {
      // Fallback: full scan (first run before webhook has populated data)
      const rooms: string[] = [];
      let cursor: string | null = null;

      do {
        const page = await liveblocks.getRooms({
          query: { roomId: { startsWith: "markdown:" } },
          limit: 100,
          ...(cursor ? { startingAfter: cursor } : {}),
        });
        rooms.push(...page.data.map((r) => r.id));
        cursor = page.nextCursor;
      } while (cursor);

      roomsToQuery = rooms;
      mode = "full-scan";

      // Seed Convex with the results so future requests use the fast path
      // (done async, don't block response)
      seedConvexInBackground(liveblocks, roomsToQuery, siteData);
    }

    timing.listRooms = Date.now() - t0;
    if (!includeSensitive) {
      roomsToQuery = await filterPublicRooms(roomsToQuery, siteData);
    }
    timing.roomCount = roomsToQuery.length;

    // ── 2. Fetch threads from active rooms in parallel ──────
    const t1 = Date.now();

    const allThreads: Array<{
      id: string;
      roomId: string;
      createdAt: string;
      updatedAt: string;
      resolved: boolean;
      comments: Array<{
        id: string;
        userId: string;
        createdAt: string;
        body: unknown;
      }>;
      metadata: Record<string, unknown>;
    }> = [];

    const results = await Promise.allSettled(
      roomsToQuery.map(async (roomId) => {
        const { data } = await liveblocks.getThreads({ roomId });
        return { roomId, threads: data };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const thread of result.value.threads) {
          allThreads.push({
            id: thread.id,
            roomId: thread.roomId,
            createdAt: thread.createdAt.toISOString(),
            updatedAt:
              thread.updatedAt?.toISOString() ??
              thread.createdAt.toISOString(),
            resolved: thread.resolved,
            comments: thread.comments.map((c) => ({
              id: c.id,
              userId: c.userId,
              createdAt: c.createdAt.toISOString(),
              body: c.body,
            })),
            metadata: (thread.metadata ?? {}) as Record<string, unknown>,
          });
        }
      }
    }

    timing.fetchThreads = Date.now() - t1;

    // ── 3. Resolve user names ───────────────────────────────
    const t2 = Date.now();
    const uniqueUserIds = [
      ...new Set(
        allThreads.flatMap((t) => t.comments.map((c) => c.userId))
      ),
    ];
    const resolvedUsers = await resolveLiveblocksUsers(uniqueUserIds, siteData);
    const userNames = Object.fromEntries(
      Object.entries(resolvedUsers).map(([id, user]) => [id, user.name])
    );

    timing.resolveNames = Date.now() - t2;
    timing.total = Date.now() - t0;

    const body = {
      threads: allThreads,
      userNames,
      _timing: { ...timing, mode },
    };

    // Cache the response
    responseCache.set(cacheKey, { body, timestamp: Date.now() });

    console.log(
      `[liveblocks-threads] ${mode} | ` +
        `${roomsToQuery.length} rooms queried, ${allThreads.length} threads | ` +
        `convexLookup=${timing.convexLookup}ms fetchThreads=${timing.fetchThreads}ms resolveNames=${timing.resolveNames}ms total=${timing.total}ms`
    );

    return NextResponse.json(body);
  } catch (err) {
    console.error("[liveblocks-threads] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch threads" },
      { status: 500 }
    );
  }
}

async function filterPublicRooms(roomIds: string[], siteData: SiteData) {
  const sensitive = await Promise.all(
    roomIds.map(async (roomId) => {
      if (!roomId.startsWith("markdown:")) return false;
      const doc = await siteData.documents.getBySlug({
        slug: roomId.slice("markdown:".length),
        includeSensitive: true,
      });
      return doc?.sensitive === true;
    }),
  );
  return roomIds.filter((_, index) => !sensitive[index]);
}

// ── Background seed ────────────────────────────────────────
// On first request (no Convex data yet), fetch threads from all rooms
// and populate Convex so the webhook path works going forward.

async function seedConvexInBackground(
  liveblocks: Liveblocks,
  allRoomIds: string[],
  siteData: SiteData,
) {
  try {
    const roomCounts: Array<{ roomId: string; threadCount: number }> = [];

    const results = await Promise.allSettled(
      allRoomIds.map(async (roomId) => {
        const { data } = await liveblocks.getThreads({ roomId });
        return { roomId, threadCount: data.length };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.threadCount > 0) {
        roomCounts.push(result.value);
      }
    }

    if (roomCounts.length > 0) {
      await siteData.commentRooms.syncRooms({ rooms: roomCounts });
      console.log(
        `[liveblocks-threads] Seeded ${roomCounts.length} active rooms into Convex`
      );
    }
  } catch (err) {
    console.error("[liveblocks-threads] Background seed error:", err);
  }
}

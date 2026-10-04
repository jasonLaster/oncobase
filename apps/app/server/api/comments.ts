import type { ConvexHttpClient } from "convex/browser";
import { Liveblocks, WebhookHandler } from "@liveblocks/node";
import {
  liveblocksDisabledResponse,
  resolveLiveblocksConfig,
} from "@oncobase/wiki-comments/site";
import {
  persistLiveblocksGuestName,
  resolveLiveblocksUsers,
} from "@oncobase/wiki-comments/user-resolution";
import {
  LIVEBLOCKS_GUEST_COOKIE,
  parseGuestUser,
} from "@oncobase/wiki-comments/guest-user";
import { api } from "../../convex/_generated/api.js";
import type { Id } from "../../convex/_generated/dataModel.js";
import { traceBackendPhase } from "../backend-tracing";
import { runAfterResponse } from "../background";
import { DEFAULT_SITE_SLUG, getSessionUser, withSiteSlug } from "../reader-access";
import { fetchSlugSensitivity } from "../slug-batch";

export type CachedLiveblocksThreadsResponse = {
  body: object;
  timestamp: number;
};

export const LIVEBLOCKS_THREADS_RESPONSE_TTL_MS = 30_000;
export const liveblocksThreadsResponseCache = new Map<string, CachedLiveblocksThreadsResponse>();

export function commentsFeatureEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_COMMENTS !== "false";
}

export function liveblocksUserAdapter(client: ConvexHttpClient, siteSlug: string) {
  return {
    getUsersByIds: (ids: string[]) =>
      client.query(
        api.users.getUsersByIds,
        withSiteSlug(siteSlug, { ids: ids as Id<"users">[] }),
      ),
    getGuestNamesByIds: (guestIds: string[]) =>
      client.query(api.guestNames.getByIds, withSiteSlug(siteSlug, { guestIds })),
    upsertGuestName: (guest: { id: string; name: string }) =>
      client.mutation(
        api.guestNames.upsert,
        withSiteSlug(siteSlug, { guestId: guest.id, name: guest.name }),
        { skipQueue: true },
      ),
  };
}

export async function getLiveblocksConfig(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  return resolveLiveblocksConfig(request, {
    defaultSiteSlug: DEFAULT_SITE_SLUG,
    getSiteBySlug: (slug) => client.query(api.sites.getBySlug, { slug }),
    isCommentsFeatureEnabled: commentsFeatureEnabled,
    siteSlugFromRequest: () => siteSlug,
  });
}

export function parseGuestUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const guestCookie = cookieHeader
    .split(/;\s*/)
    .find((part) => part.startsWith(`${LIVEBLOCKS_GUEST_COOKIE}=`))
    ?.slice(LIVEBLOCKS_GUEST_COOKIE.length + 1);
  return parseGuestUser(guestCookie);
}

export const COMMENT_ROOM_PREFIX = "markdown:";

export async function isSensitiveCommentRoom(
  roomId: string,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (!roomId.startsWith(COMMENT_ROOM_PREFIX)) return false;
  const slug = roomId.slice(COMMENT_ROOM_PREFIX.length);
  const sensitivity = await fetchSlugSensitivity(client, siteSlug, [slug]);
  return sensitivity.get(slug) === true;
}

export async function filterPublicCommentRooms(
  roomIds: string[],
  client: ConvexHttpClient,
  siteSlug: string,
) {
  // One chunked sensitivity lookup instead of a full document read per room.
  const sensitivity = await fetchSlugSensitivity(
    client,
    siteSlug,
    roomIds
      .filter((roomId) => roomId.startsWith(COMMENT_ROOM_PREFIX))
      .map((roomId) => roomId.slice(COMMENT_ROOM_PREFIX.length)),
  );
  return roomIds.filter((roomId) =>
    !roomId.startsWith(COMMENT_ROOM_PREFIX) ||
    sensitivity.get(roomId.slice(COMMENT_ROOM_PREFIX.length)) !== true);
}

export function invalidateLiveblocksThreadsCache(siteSlug?: string) {
  if (!siteSlug) {
    liveblocksThreadsResponseCache.clear();
    return;
  }
  liveblocksThreadsResponseCache.delete(`${siteSlug}:public`);
  liveblocksThreadsResponseCache.delete(`${siteSlug}:private`);
}

export async function seedCommentRoomsInBackground(
  liveblocks: Liveblocks,
  allRoomIds: string[],
  client: ConvexHttpClient,
  siteSlug: string,
) {
  try {
    const roomCounts: Array<{ roomId: string; threadCount: number }> = [];
    const results = await Promise.allSettled(
      allRoomIds.map(async (roomId) => {
        const { data } = await liveblocks.getThreads({ roomId });
        return { roomId, threadCount: data.length };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.threadCount > 0) {
        roomCounts.push(result.value);
      }
    }

    if (roomCounts.length > 0) {
      await client.mutation(
        api.commentRooms.syncRooms,
        withSiteSlug(siteSlug, { rooms: roomCounts }),
        { skipQueue: true },
      );
      console.log(
        `[liveblocks-threads] Seeded ${roomCounts.length} active rooms into Convex`,
      );
    }
  } catch (error) {
    console.error("[liveblocks-threads] Background seed error:", error);
  }
}

export async function handleLiveblocksAuthRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method === "GET") {
    const config = await getLiveblocksConfig(request, client, siteSlug);
    return Response.json({
      configured: config.ok,
      siteSlug: config.ok ? config.creds.siteSlug : config.siteSlug,
      reason: config.ok ? null : config.reason,
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET, POST" } },
    );
  }

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const { room } = (await request.json().catch(() => ({}))) as { room?: string };
  if (!room || typeof room !== "string") {
    return Response.json({ error: "room is required" }, { status: 400 });
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser && (await isSensitiveCommentRoom(room, client, siteSlug))) {
    return Response.json({ error: "Room not found" }, { status: 404 });
  }

  const guestUser = sessionUser ? null : parseGuestUserFromRequest(request);
  if (guestUser) {
    await persistLiveblocksGuestName(
      guestUser,
      liveblocksUserAdapter(client, siteSlug),
    ).catch(() => {});
  }

  const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
  const userId = sessionUser?._id ?? guestUser?.id ?? `guest:${room}`;
  const userInfo = {
    name: sessionUser?.name || sessionUser?.email || guestUser?.name || "Guest",
    email: sessionUser?.email,
  };

  const session = liveblocks.prepareSession(userId, { userInfo });
  session.allow(room, sessionUser ? session.FULL_ACCESS : session.READ_ACCESS);
  const { body, status } = await session.authorize();
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleLiveblocksThreadsRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
  const includeSensitive = Boolean(await getSessionUser(request, client, siteSlug));
  const cacheKey = `${siteSlug}:${includeSensitive ? "private" : "public"}`;
  const url = new URL(request.url);
  const bypassCache =
    url.searchParams.get("fresh") === "1" ||
    request.headers.get("cache-control")?.includes("no-cache") === true;
  const cached = liveblocksThreadsResponseCache.get(cacheKey);
  if (!bypassCache && cached && Date.now() - cached.timestamp < LIVEBLOCKS_THREADS_RESPONSE_TTL_MS) {
    return Response.json(cached.body);
  }

  const startedAt = Date.now();
  const timing: Record<string, number> = {};

  try {
    let roomsToQuery: string[];
    let mode: string;
    let activeRooms: string[] = [];

    if (!bypassCache) {
      try {
        activeRooms = await client.query(
          api.commentRooms.listActive,
          withSiteSlug(siteSlug, {}),
        );
      } catch {
        activeRooms = [];
      }
    }
    timing.convexLookup = Date.now() - startedAt;

    if (activeRooms.length > 0) {
      roomsToQuery = activeRooms;
      mode = "convex";
    } else {
      const rooms: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await liveblocks.getRooms({
          query: { roomId: { startsWith: "markdown:" } },
          limit: 100,
          ...(cursor ? { startingAfter: cursor } : {}),
        });
        rooms.push(...page.data.map((room) => room.id));
        cursor = page.nextCursor;
      } while (cursor);

      roomsToQuery = rooms;
      mode = "full-scan";
      runAfterResponse(seedCommentRoomsInBackground(liveblocks, roomsToQuery, client, siteSlug), "liveblocks-threads seed");
    }

    timing.listRooms = Date.now() - startedAt;
    if (!includeSensitive) {
      roomsToQuery = await filterPublicCommentRooms(roomsToQuery, client, siteSlug);
    }
    timing.roomCount = roomsToQuery.length;

    const fetchStartedAt = Date.now();
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

    // One Liveblocks request per room, unbounded: trace the fan-out as a unit.
    const results = await traceBackendPhase("external.liveblocks", () => Promise.allSettled(
      roomsToQuery.map(async (roomId) => {
        const { data } = await liveblocks.getThreads({ roomId });
        return { roomId, threads: data };
      }),
    ));

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const thread of result.value.threads) {
        allThreads.push({
          id: thread.id,
          roomId: thread.roomId,
          createdAt: thread.createdAt.toISOString(),
          updatedAt:
            thread.updatedAt?.toISOString() ?? thread.createdAt.toISOString(),
          resolved: thread.resolved,
          comments: thread.comments.map((comment) => ({
            id: comment.id,
            userId: comment.userId,
            createdAt: comment.createdAt.toISOString(),
            body: comment.body,
          })),
          metadata: (thread.metadata ?? {}) as Record<string, unknown>,
        });
      }
    }
    timing.fetchThreads = Date.now() - fetchStartedAt;

    const resolveStartedAt = Date.now();
    const uniqueUserIds = [
      ...new Set(allThreads.flatMap((thread) => thread.comments.map((comment) => comment.userId))),
    ];
    const resolvedUsers = await resolveLiveblocksUsers(
      uniqueUserIds,
      liveblocksUserAdapter(client, siteSlug),
    );
    const userNames = Object.fromEntries(
      Object.entries(resolvedUsers).map(([id, user]) => [id, user.name]),
    );
    timing.resolveNames = Date.now() - resolveStartedAt;
    timing.total = Date.now() - startedAt;

    const body = {
      threads: allThreads,
      userNames,
      _timing: { ...timing, mode },
    };
    if (!bypassCache) {
      liveblocksThreadsResponseCache.set(cacheKey, { body, timestamp: Date.now() });
    }

    console.log(
      `[liveblocks-threads] ${mode} | ${roomsToQuery.length} rooms queried, ${allThreads.length} threads | convexLookup=${timing.convexLookup}ms fetchThreads=${timing.fetchThreads}ms resolveNames=${timing.resolveNames}ms total=${timing.total}ms`,
    );

    return Response.json(body, {
      headers: bypassCache ? { "Cache-Control": "no-store" } : undefined,
    });
  } catch (error) {
    console.error("[liveblocks-threads] Error:", error);
    return Response.json({ error: "Failed to fetch threads" }, { status: 500 });
  }
}

export async function handleLiveblocksAddCommentRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const { roomId, threadId, body: commentText } = (await request.json().catch(() => ({}))) as {
    roomId?: string;
    threadId?: string;
    body?: string;
  };
  if (!roomId || !threadId || !commentText?.trim()) {
    return Response.json(
      { error: "roomId, threadId, and body are required" },
      { status: 400 },
    );
  }

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) {
    return Response.json({ error: "Sign in to comment" }, { status: 401 });
  }

  try {
    const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
    const comment = await liveblocks.createComment({
      roomId,
      threadId,
      data: {
        userId: sessionUser._id,
        body: {
          version: 1,
          content: [
            {
              type: "paragraph",
              children: [{ text: commentText.trim() }],
            },
          ],
        },
      },
    });
    return Response.json({ ok: true, comment });
  } catch (error) {
    console.error("[liveblocks-add-comment] Error:", error);
    return Response.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

export async function handleLiveblocksDeleteThreadRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const { roomId, threadId } = (await request.json().catch(() => ({}))) as {
    roomId?: string;
    threadId?: string;
  };
  if (!roomId || !threadId) {
    return Response.json(
      { error: "roomId and threadId are required" },
      { status: 400 },
    );
  }

  const config = await getLiveblocksConfig(request, client, siteSlug);
  if (!config.ok) return liveblocksDisabledResponse(config);

  const sessionUser = await getSessionUser(request, client, siteSlug);
  if (!sessionUser) {
    return Response.json({ error: "Sign in to manage comments" }, { status: 401 });
  }

  try {
    const liveblocks = new Liveblocks({ secret: config.creds.secretKey });
    await liveblocks.deleteThread({ roomId, threadId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[liveblocks-delete-thread] Error:", error);
    return Response.json({ error: "Failed to delete thread" }, { status: 500 });
  }
}

export async function handleLiveblocksUsersRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const body = (await request.json().catch(() => null)) as { userIds?: unknown } | null;
  if (!Array.isArray(body?.userIds)) {
    return Response.json({ error: "userIds array is required" }, { status: 400 });
  }

  const userIds = body.userIds.filter(
    (userId): userId is string => typeof userId === "string",
  );
  if (userIds.length !== body.userIds.length) {
    return Response.json(
      { error: "userIds must only contain strings" },
      { status: 400 },
    );
  }
  if (userIds.length > 100) {
    return Response.json(
      { error: "userIds is limited to 100 entries" },
      { status: 400 },
    );
  }

  const users = await resolveLiveblocksUsers(
    userIds,
    liveblocksUserAdapter(client, siteSlug),
  );
  return Response.json({ users });
}

export async function handleLiveblocksGuestRequest(
  request: Request,
  client: ConvexHttpClient,
  siteSlug: string,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const { guestId, name } = (await request.json().catch(() => ({}))) as {
    guestId?: string;
    name?: string;
  };
  if (!guestId || !name) {
    return Response.json({ error: "guestId and name required" }, { status: 400 });
  }

  try {
    await persistLiveblocksGuestName(
      { id: guestId, name },
      liveblocksUserAdapter(client, siteSlug),
    );
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Failed to save guest name" }, { status: 500 });
  }
}

export async function resolveLiveblocksWebhookSiteSlug(
  event: { data?: { projectId?: string } },
  client: ConvexHttpClient,
) {
  const workspaceId = event.data?.projectId;
  if (!workspaceId) return DEFAULT_SITE_SLUG;
  try {
    const site = await client.query(api.sites.getByLiveblocksWorkspace, {
      workspaceId,
    });
    return site?.slug ?? DEFAULT_SITE_SLUG;
  } catch {
    return DEFAULT_SITE_SLUG;
  }
}

export async function handleLiveblocksWebhookRequest(
  request: Request,
  client: ConvexHttpClient,
) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json(
      { error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  let event: { type?: string; data?: { projectId?: string; roomId?: string } };
  try {
    event = new WebhookHandler(webhookSecret).verifyRequest({
      headers: Object.fromEntries(request.headers.entries()),
      rawBody,
    }) as typeof event;
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const webhookSiteSlug = await resolveLiveblocksWebhookSiteSlug(event, client);

  try {
    switch (event.type) {
      case "threadCreated":
        if (event.data?.roomId) {
          await client.mutation(
            api.commentRooms.incrementRoom,
            withSiteSlug(webhookSiteSlug, { roomId: event.data.roomId }),
            { skipQueue: true },
          );
          invalidateLiveblocksThreadsCache(webhookSiteSlug);
        }
        break;
      case "threadDeleted":
        if (event.data?.roomId) {
          await client.mutation(
            api.commentRooms.decrementRoom,
            withSiteSlug(webhookSiteSlug, { roomId: event.data.roomId }),
            { skipQueue: true },
          );
          invalidateLiveblocksThreadsCache(webhookSiteSlug);
        }
        break;
      case "commentCreated":
      case "commentEdited":
      case "commentDeleted":
      case "threadMarkedAsResolved":
      case "threadMarkedAsUnresolved":
        invalidateLiveblocksThreadsCache(webhookSiteSlug);
        break;
    }
  } catch (error) {
    console.error("[liveblocks-webhook] Error processing event:", error);
    return Response.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}

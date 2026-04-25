import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { GuestUser } from "@/lib/guest-user";
import { getConvexServerClient } from "@/lib/convex-server";
import {
  formatLiveblocksUserId,
  type ResolvedLiveblocksUser,
} from "@/lib/liveblocks-user-format";

const CONVEX_USER_ID_RE = /^[a-z0-9]{32}$/;

function uniqueUserIds(userIds: readonly string[]) {
  return [
    ...new Set(
      userIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    ),
  ];
}

export async function persistLiveblocksGuestName(guest: GuestUser | null) {
  if (!guest) return;

  const guestId = guest.id.trim();
  const name = guest.name.trim();
  if (!guestId || !name) return;

  const convex = getConvexServerClient();
  await convex.mutation(api.guestNames.upsert, { guestId, name });
}

export async function resolveLiveblocksUsers(
  userIds: readonly string[]
): Promise<Record<string, ResolvedLiveblocksUser>> {
  const ids = uniqueUserIds(userIds);
  const resolvedUsers: Record<string, ResolvedLiveblocksUser> = {};

  try {
    const convex = getConvexServerClient();
    const convexIds = ids.filter((id) => CONVEX_USER_ID_RE.test(id));
    const guestIds = ids.filter((id) => id.startsWith("guest_"));

    await Promise.allSettled([
      convexIds.length > 0
        ? convex
            .query(api.users.getUsersByIds, {
              ids: convexIds as Id<"users">[],
            })
            .then((users) => {
              for (const user of users) {
                resolvedUsers[user.id] = {
                  name: user.name ?? user.email,
                  email: user.email,
                };
              }
            })
        : Promise.resolve(),
      guestIds.length > 0
        ? convex
            .query(api.guestNames.getByIds, { guestIds })
            .then((guestNameMap) => {
              for (const [id, name] of Object.entries(guestNameMap)) {
                resolvedUsers[id] = { name };
              }
            })
        : Promise.resolve(),
    ]);
  } catch {
    // Name resolution should never block rendering comments. Fall through to
    // stable display fallbacks when Convex is unavailable.
  }

  for (const id of ids) {
    resolvedUsers[id] ??= { name: formatLiveblocksUserId(id) };
  }

  return resolvedUsers;
}

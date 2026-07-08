import type { GuestUser } from "./guest-user.ts";
import {
  formatLiveblocksUserId,
  type ResolvedLiveblocksUser,
} from "./user-format.ts";

const CONVEX_USER_ID_RE = /^[a-z0-9]{32}$/;

export type LiveblocksUserRecord = {
  id: string;
  name: string | null;
  email: string;
};

export type LiveblocksUserResolutionAdapter = {
  getUsersByIds: (ids: string[]) => Promise<LiveblocksUserRecord[]>;
  getGuestNamesByIds: (guestIds: string[]) => Promise<Record<string, string>>;
  upsertGuestName: (guest: GuestUser) => Promise<unknown>;
};

function uniqueUserIds(userIds: readonly string[]) {
  return [
    ...new Set(
      userIds
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    ),
  ];
}

export async function persistLiveblocksGuestName(
  guest: GuestUser | null,
  adapter: Pick<LiveblocksUserResolutionAdapter, "upsertGuestName">,
) {
  if (!guest) return;

  const guestId = guest.id.trim();
  const name = guest.name.trim();
  if (!guestId || !name) return;

  await adapter.upsertGuestName({ id: guestId, name });
}

export async function resolveLiveblocksUsers(
  userIds: readonly string[],
  adapter: Pick<
    LiveblocksUserResolutionAdapter,
    "getUsersByIds" | "getGuestNamesByIds"
  >,
): Promise<Record<string, ResolvedLiveblocksUser>> {
  const ids = uniqueUserIds(userIds);
  const resolvedUsers: Record<string, ResolvedLiveblocksUser> = {};

  try {
    const convexIds = ids.filter((id) => CONVEX_USER_ID_RE.test(id));
    const guestIds = ids.filter((id) => id.startsWith("guest_"));

    await Promise.allSettled([
      convexIds.length > 0
        ? adapter
            .getUsersByIds(convexIds)
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
        ? adapter
            .getGuestNamesByIds(guestIds)
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

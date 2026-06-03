import type { GuestUser } from "./guest-user.ts";
import {
  formatLiveblocksUserId,
  type ResolvedLiveblocksUser,
} from "./user-format.ts";

/**
 * Structural subset of an app's SiteData that comment user-resolution needs.
 * Declared here (with method syntax, so parameters compare bivariantly) so the
 * package does not depend on app-specific Convex types — each app's real
 * SiteData satisfies this interface structurally.
 */
export interface CommentsSiteData {
  users: {
    getUsersByIds(args: { ids: string[] }): Promise<
      ReadonlyArray<{ id: string; name?: string | null; email: string }>
    >;
  };
  guestNames: {
    upsert(args: { guestId: string; name: string }): Promise<unknown>;
    getByIds(args: { guestIds: string[] }): Promise<Record<string, string>>;
  };
}

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

export async function persistLiveblocksGuestName(
  guest: GuestUser | null,
  siteData: CommentsSiteData,
) {
  if (!guest) return;

  const guestId = guest.id.trim();
  const name = guest.name.trim();
  if (!guestId || !name) return;

  await siteData.guestNames.upsert({ guestId, name });
}

export async function resolveLiveblocksUsers(
  userIds: readonly string[],
  siteData: CommentsSiteData,
): Promise<Record<string, ResolvedLiveblocksUser>> {
  const ids = uniqueUserIds(userIds);
  const resolvedUsers: Record<string, ResolvedLiveblocksUser> = {};

  try {
    const convexIds = ids.filter((id) => CONVEX_USER_ID_RE.test(id));
    const guestIds = ids.filter((id) => id.startsWith("guest_"));

    await Promise.allSettled([
      convexIds.length > 0
        ? siteData.users
            .getUsersByIds({ ids: convexIds })
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
        ? siteData.guestNames
            .getByIds({ guestIds })
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

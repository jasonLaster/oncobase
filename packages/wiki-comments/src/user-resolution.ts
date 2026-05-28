import type { Id } from "../../../web/convex/_generated/dataModel";
import type { GuestUser } from "../../../web/src/lib/guest-user";
import type { SiteData } from "../../../web/src/lib/site-data";
import {
  formatLiveblocksUserId,
  type ResolvedLiveblocksUser,
} from "./user-format";

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
  siteData: SiteData,
) {
  if (!guest) return;

  const guestId = guest.id.trim();
  const name = guest.name.trim();
  if (!guestId || !name) return;

  await siteData.guestNames.upsert({ guestId, name });
}

export async function resolveLiveblocksUsers(
  userIds: readonly string[],
  siteData: SiteData,
): Promise<Record<string, ResolvedLiveblocksUser>> {
  const ids = uniqueUserIds(userIds);
  const resolvedUsers: Record<string, ResolvedLiveblocksUser> = {};

  try {
    const convexIds = ids.filter((id) => CONVEX_USER_ID_RE.test(id));
    const guestIds = ids.filter((id) => id.startsWith("guest_"));

    await Promise.allSettled([
      convexIds.length > 0
        ? siteData.users
            .getUsersByIds({
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

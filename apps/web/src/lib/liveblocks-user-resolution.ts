import type { Id } from "@convex/_generated/dataModel";
import type { GuestUser } from "@/lib/guest-user";
import type { SiteData } from "@/lib/site-data";
import {
  persistLiveblocksGuestName as persistLiveblocksGuestNameWithAdapter,
  resolveLiveblocksUsers as resolveLiveblocksUsersWithAdapter,
} from "@oncobase/wiki-comments/user-resolution";

function siteDataAdapter(siteData: SiteData) {
  return {
    getUsersByIds: (ids: string[]) =>
      siteData.users.getUsersByIds({ ids: ids as Id<"users">[] }),
    getGuestNamesByIds: (guestIds: string[]) =>
      siteData.guestNames.getByIds({ guestIds }),
    upsertGuestName: (guest: GuestUser) =>
      siteData.guestNames.upsert({ guestId: guest.id, name: guest.name }),
  };
}

export function persistLiveblocksGuestName(
  guest: GuestUser | null,
  siteData: SiteData,
) {
  return persistLiveblocksGuestNameWithAdapter(guest, siteDataAdapter(siteData));
}

export function resolveLiveblocksUsers(
  userIds: readonly string[],
  siteData: SiteData,
) {
  return resolveLiveblocksUsersWithAdapter(userIds, siteDataAdapter(siteData));
}

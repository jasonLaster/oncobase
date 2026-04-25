export type ResolvedLiveblocksUser = {
  name: string;
  email?: string;
};

export function formatLiveblocksUserId(userId: string): string {
  if (userId.startsWith("guest_") || userId.startsWith("guest:")) {
    return "Guest";
  }

  if (userId === "anonymous") {
    return "Anonymous";
  }

  if (/^[a-z0-9]{32}$/.test(userId)) {
    return "User";
  }

  return userId.length > 20 ? `${userId.slice(0, 12)}...` : userId;
}

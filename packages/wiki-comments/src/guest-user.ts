export const LIVEBLOCKS_GUEST_COOKIE = "liveblocks_guest";
export const LIVEBLOCKS_GUEST_STORAGE_KEY = "liveblocks_guest";

export type GuestUser = {
  id: string;
  name: string;
};

const ADJECTIVES = [
  "Amber",
  "Astro",
  "Bold",
  "Bright",
  "Clever",
  "Comet",
  "Curious",
  "Daring",
  "Electric",
  "Golden",
  "Lucky",
  "Merry",
  "Misty",
  "Nova",
  "Quiet",
  "Rapid",
  "Solar",
  "Swift",
  "Velvet",
  "Wild",
] as const;

const LABELS = [
  "Reader",
  "Visitor",
  "Reviewer",
  "Scout",
  "Guide",
  "Editor",
  "Observer",
  "Navigator",
  "Analyst",
  "Scribe",
] as const;

function randomItem<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function createGuestUser(): GuestUser {
  const adjective = randomItem(ADJECTIVES);
  const label = randomItem(LABELS);
  const suffix = Math.floor(100 + Math.random() * 900);

  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `guest_${crypto.randomUUID()}`
        : `guest_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`,
    name: `${adjective} ${label} ${suffix}`,
  };
}

export function serializeGuestUser(guest: GuestUser) {
  return encodeURIComponent(JSON.stringify(guest));
}

export function parseGuestUser(value: string | undefined | null): GuestUser | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<GuestUser>;
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") {
      return null;
    }
    return { id: parsed.id, name: parsed.name };
  } catch {
    return null;
  }
}
